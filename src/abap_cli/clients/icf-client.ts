import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as https from 'https';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';

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
    const resp = await this.http.get<IcfResponse<T>>(path);
    return resp.data;
  }

  async post<T>(path: string, body: unknown): Promise<IcfResponse<T>> {
    const resp = await this.http.post<IcfResponse<T>>(path, body);
    return resp.data;
  }

  async put<T>(path: string, body: unknown): Promise<IcfResponse<T>> {
    const resp = await this.http.put<IcfResponse<T>>(path, body);
    return resp.data;
  }
}
