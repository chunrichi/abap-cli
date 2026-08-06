import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as https from 'https';
import { loadConfig, readCaCertificate, type ProjectConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
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

  /** Run one HTTP call and normalize transport errors into a CliError. */
  private async request<T>(method: 'get' | 'post' | 'put', path: string, body?: unknown): Promise<IcfResponse<T>> {
    let resp: AxiosResponse<IcfResponse<T>>;
    try {
      if (method === 'get') resp = await this.http.get<IcfResponse<T>>(path);
      else if (method === 'post') resp = await this.http.post<IcfResponse<T>>(path, body);
      else resp = await this.http.put<IcfResponse<T>>(path, body);
    } catch (error: unknown) {
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
