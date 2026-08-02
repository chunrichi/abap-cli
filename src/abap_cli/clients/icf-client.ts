import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as https from 'https';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';

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
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
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

function toHttpError(error: unknown): CliError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;
    return new CliError('SAP_ERROR', `ICF request failed: ${message}`, status ? { httpStatus: status } : undefined);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError('SAP_ERROR', `ICF request failed: ${message}`);
}
