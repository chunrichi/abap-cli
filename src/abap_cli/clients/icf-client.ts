import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { buildAuth } from '../auth/adapter.js';
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

  private constructor(config: ProjectConfig, authOpts: { passwordOrFetcher: string | (() => Promise<string>); options: import('abap-adt-api').ClientOptions }) {
    this.baseUrl = `${config.sap.url}/sap/zabap_vibe`;

    // Reuse the SAME artefacts `buildAuth()` produces for ADT — `httpsAgent`
    // (cert mTLS) and `headers.Cookie` (browser_sso) flow through verbatim,
    // so every auth strategy that works for ADT now also works for ICF.
    //
    // For strategies whose `passwordOrFetcher` is an async BearerFetcher
    // (oauth_password), axios basic-auth can't carry it, so we fall back to
    // the SAP-conventional placeholder password and rely on a future
    // Authorization-header strategy. For literal-password strategies (basic,
    // cert, browser_sso) we pass the literal through.
    const password = typeof authOpts.passwordOrFetcher === 'string'
      ? authOpts.passwordOrFetcher
      : 'icf-fallback'; // oauth_password strategies plug in here when supported

    this.http = axios.create({
      baseURL: this.baseUrl,
      auth: { username: config.sap.username, password },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'sap-client': config.sap.client,
        ...(authOpts.options.headers ?? {}),
      },
      httpsAgent: authOpts.options.httpsAgent,
      timeout: 30000,
    });
  }

  static async create(): Promise<IcfClient> {
    const config = await loadConfig();
    const authOpts = await buildAuth(config.sap, config.systemName);
    return new IcfClient(config, authOpts);
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

  /** POST /ddic/<type> — create/overwrite a DDIC object. */
  async postDdic<T>(type: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/ddic/${type}`, body);
  }

  /** GET /ddic/<type>/<name> — pull a DDIC object as wire JSON. */
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

  /** POST /tran/<tcode> — create/overwrite a transaction code (SE93). */
  async postTran<T>(tcode: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/tran/${encodeURIComponent(tcode)}`, body);
  }

  /** GET /tran/<tcode> — pull a transaction code as wire JSON. */
  async getTran<T>(tcode: string): Promise<IcfResponse<T>> {
    return this.get(`/tran/${encodeURIComponent(tcode)}`);
  }

  /** GET /tcode/<tcode> — resolve a transaction code to its entry program (read-only). */
  async getTcode<T>(tcode: string): Promise<IcfResponse<T>> {
    return this.get(`/tcode/${encodeURIComponent(tcode)}`);
  }

  /** GET /textpool/<category>?object=...&type=... — read text elements. */
  async getTextpool<T>(category: string, object: string, type: string): Promise<IcfResponse<T>> {
    const qs = new URLSearchParams({ object, type });
    return this.get(`/textpool/${category}?${qs.toString()}`);
  }

  /** POST /textpool/<category>?object=...&type=... — write text elements. */
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
        const data = error.response?.data as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
        if (data && typeof data === 'object' && data.error && typeof data.error.code === 'string') {
          throw new CliError(data.error.code as ErrorCode, data.error.message ?? 'ICF request failed', {
            details: data.error.details,
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
  const classified = classifyHttpError(error);
  return new CliError(classified.code, `ICF request failed: ${classified.message}`, {
    details: classified.details,
    nextSteps: classified.nextSteps,
    example: classified.example,
  });
}
