import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as https from 'https';
import { loadConfig, readCaCertificate, type ProjectConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { classifyHttpError } from './http-error.js';

export interface IcfResponse<T = unknown> {
  status: 'success' | 'error';
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: unknown[];
  } | null;
}

export class IcfClient {
  private http: AxiosInstance;
  private baseUrl: string;

  private constructor(config: ProjectConfig) {
    this.baseUrl = `${config.sap.url}/sap/zabap_vibe`;
    this.http = axios.create({
      baseURL: this.baseUrl,
      auth: {
        username: config.sap.username,
        password: config.sap.password || '',
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'sap-client': config.sap.client,
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: !config.sap.insecure,
        ca: readCaCertificate(config.sap.caPath),
      }),
      timeout: 30000,
    });
  }

  static async create(): Promise<IcfClient> {
    const config = await loadConfig();
    return new IcfClient(config);
  }

  async get<T>(path: string): Promise<IcfResponse<T>> {
    return this.request('get', path);
  }

  async post<T>(path: string, body: unknown): Promise<IcfResponse<T>> {
    return this.request('post', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<IcfResponse<T>> {
    return this.request('put', path, body);
  }

  /** 014: POST /ddic/<type> — create/overwrite a DDIC object (FR-001). */
  async postDdic<T>(type: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/ddic/${type}`, body);
  }

  /** 014: GET /ddic/<type>/<name> — pull a DDIC object as wire JSON (FR-011). */
  async getDdic<T>(type: string, name: string): Promise<IcfResponse<T>> {
    return this.get(`/ddic/${type}/${encodeURIComponent(name)}`);
  }

  /** 022: POST /http/<name> — create/overwrite an HTTP service (SICF node). */
  async postHttp<T>(name: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/http/${encodeURIComponent(name)}`, body);
  }

  /** 022: GET /http/<name> — pull an HTTP service as wire JSON. */
  async getHttp<T>(name: string): Promise<IcfResponse<T>> {
    return this.get(`/http/${encodeURIComponent(name)}`);
  }

  /** GET /tcode/<tcode> — resolve a transaction code to its entry program (read-only). */
  async getTcode<T>(tcode: string): Promise<IcfResponse<T>> {
    return this.get(`/tcode/${encodeURIComponent(tcode)}`);
  }

  /** 014: GET /textpool/<category>?object=...&type=... — read text elements (US4). */
  async getTextpool<T>(category: string, object: string, type: string): Promise<IcfResponse<T>> {
    const qs = new URLSearchParams({ object, type });
    return this.get(`/textpool/${category}?${qs.toString()}`);
  }

  /** 014: POST /textpool/<category>?object=...&type=... — write text elements (US4). */
  async postTextpool<T>(category: string, object: string, type: string, body: unknown): Promise<IcfResponse<T>> {
    const qs = new URLSearchParams({ object, type });
    return this.post(`/textpool/${category}?${qs.toString()}`, body);
  }

  /** 015: GET /version-source — active (00000) source of an object as transported to a remote system. */
  async getRemoteSource<T>(objectType: string, objectName: string, destination: string): Promise<IcfResponse<T>> {
    const qs = new URLSearchParams({ objectType, objectName, destination });
    return this.get(`/version-source?${qs.toString()}`);
  }

  /**
   * 016-abap-select: POST /data/query — read-only table data query.
   *
   * The SAP-side handler validates the request against DD02L/DD03L metadata,
   * parses the `where` clause, and executes a dynamic Open SQL statement with
   * value parameters bound separately (see research.md R1/R2 for the
   * injection-safety contract).
   *
   * Caller responsibility:
   *   - `table` must be a non-empty string (DDIC lookup is downstream)
   *   - `fields` (optional) — handler validates against DD03L
   *   - `where` (optional) — handler validates syntax and field names
   *   - `limit` (optional) — defaults to 100 on the server side; rejected > 10000
   *   - `offset` (optional) — defaults to 0; rejected > 100000
   *   - `orderBy` (optional) — handler validates field names and direction
   *   - `countOnly` (optional) — when true, server returns only `data.count`
   */
  async postDataQuery<T>(body: unknown): Promise<IcfResponse<T>> {
    return this.post('/data/query', body);
  }

  /** Run one HTTP call and normalize transport errors into a CliError. */
  private async request<T>(method: 'get' | 'post' | 'put', path: string, body?: unknown): Promise<IcfResponse<T>> {
    let resp: AxiosResponse<IcfResponse<T>>;
    try {
      if (method === 'get') resp = await this.http.get<IcfResponse<T>>(path);
      else if (method === 'post') resp = await this.http.post<IcfResponse<T>>(path, body);
      else resp = await this.http.put<IcfResponse<T>>(path, body);
    } catch (error: unknown) {
      // ICF endpoints return { status:'error', error:{ code, message, ... } } for
      // validation/not-found failures (HTTP 400/404). Surface the envelope's code
      // instead of a generic transport error so the flow maps it to the right
      // exit code (e.g. INVALID_WHERE → 7, TABLE_NOT_FOUND → 8).
      if (axios.isAxiosError(error)) {
        const body = error.response?.data as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
        if (body && typeof body === 'object' && body.error && typeof body.error.code === 'string') {
          throw new CliError(body.error.code as ErrorCode, body.error.message ?? 'ICF request failed', {
            details: body.error.details,
          });
        }
      }
      throw toHttpError(error);
    }
    return resp.data;
  }
}

/**
 * Legacy transport-error mapper. Routes everything through the shared HTTP
 * classifier so TLS / AUTH errors are recognised before reaching the consumer.
 */
function toHttpError(error: unknown): CliError {
  if (axios.isAxiosError(error)) {
    // Prefix the message so ICF errors remain identifiable in logs.
    const classified = classifyHttpError(error);
    return new CliError(classified.code, `ICF request failed: ${classified.message}`, {
      details: classified.details,
      nextSteps: classified.nextSteps,
      example: classified.example,
    });
  }
  const classified = classifyHttpError(error);
  return new CliError(classified.code, `ICF request failed: ${classified.message}`, {
    details: classified.details,
    nextSteps: classified.nextSteps,
    example: classified.example,
  });
}
