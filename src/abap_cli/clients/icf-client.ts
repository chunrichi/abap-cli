import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { buildBasicAuth } from './basic-auth.js';
import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { classifyHttpError } from './http-error.js';
import { ICF_BASE_PATH } from './icf-version.js';
import { ICF_WHOAMI_PATH, type SystemIdentity } from './system-identity.js';

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
  private config: ProjectConfig;

  private constructor(config: ProjectConfig, auth: { password: string; options: import('abap-adt-api').ClientOptions }) {
    this.config = config;
    this.baseUrl = `${config.sap.url}${ICF_BASE_PATH}`;

    // Reuse the SAME artefacts `buildBasicAuth()` produces for ADT — the TLS
    // options (`httpsAgent`) and any auth headers flow through verbatim.
    this.http = axios.create({
      baseURL: this.baseUrl,
      auth: { username: config.sap.username, password: auth.password },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'sap-client': config.sap.client,
        ...(auth.options.headers ?? {}),
      },
      httpsAgent: auth.options.httpsAgent,
      timeout: 30000,
    });
  }

  /**
   * Create a basic-auth ICF client.
   *
   * The bundled ICF service is being made stateless server-side, so this
   * client deliberately does not read or inject the ADT session jar: an ICF
   * request belongs to its own HTTP session, and replaying the ADT cookie set
   * here never joined that session anyway (it only produced stale-session
   * retries and orphan sessions).
   */
  static async create(): Promise<IcfClient> {
    const config = await loadConfig();
    const authOpts = buildBasicAuth(config.sap);
    return new IcfClient(config, authOpts);
  }

  /** Resolved project config this client connects with (profile name / endpoint). */
  getConfig(): ProjectConfig {
    return this.config;
  }

  /**
   * GET /whoami — identity of the SAP session behind the request, answered by
   * the bundled ICF service from `sy-uname` & friends. Auth-method agnostic: it
   * reports what the system authenticated, not what the profile config says.
   */
  async getSystemIdentity(): Promise<IcfResponse<SystemIdentity>> {
    return this.get<SystemIdentity>(ICF_WHOAMI_PATH);
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

  /** GET /ddic/<type>/<name>/docu — read the object's long text (DOKIL/DOKTL).
   *  Returns `DOCU_NOT_FOUND` when the object carries no documentation. */
  async getDdicDocu<T>(type: 'doma' | 'dtel', name: string): Promise<IcfResponse<T>> {
    return this.get(`/ddic/${type}/${encodeURIComponent(name)}/docu`);
  }

  /** POST /ddic/<type>/<name>/docu — write the long text; `lines: []` deletes it. */
  async postDdicDocu<T>(type: 'doma' | 'dtel', name: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/ddic/${type}/${encodeURIComponent(name)}/docu`, body);
  }

  /** DELETE /ddic/<type>/<name> — delete a VIEW through ICF. */
  async deleteDdic<T>(type: string, name: string, body?: unknown): Promise<IcfResponse<T>> {
    return this.request('delete', `/ddic/${type}/${encodeURIComponent(name)}`, body);
  }

  /** POST /http/<name> — create/overwrite an HTTP service (SICF node). */
  async postHttp<T>(name: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/http/${encodeURIComponent(name)}`, body);
  }

  /** GET /http/<name> — pull an HTTP service as wire JSON. */
  async getHttp<T>(name: string): Promise<IcfResponse<T>> {
    return this.get(`/http/${encodeURIComponent(name)}`);
  }

  /** DELETE /http/<name> — delete a local SICF node. */
  async deleteHttp<T>(name: string, body?: unknown): Promise<IcfResponse<T>> {
    return this.request('delete', `/http/${encodeURIComponent(name)}`, body);
  }

  /** POST /tran/<tcode> — create/overwrite a transaction code (SE93). */
  async postTran<T>(tcode: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/tran/${encodeURIComponent(tcode)}`, body);
  }

  /** GET /tran/<tcode> — pull a transaction code as wire JSON. */
  async getTran<T>(tcode: string): Promise<IcfResponse<T>> {
    return this.get(`/tran/${encodeURIComponent(tcode)}`);
  }

  /** POST /xslt/<name> — create/update an XSLT transformation program. */
  async postXslt<T>(name: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/xslt/${encodeURIComponent(name)}`, body);
  }

  /** GET /xslt/<name> — pull an XSLT transformation program as wire JSON. */
  async getXslt<T>(name: string): Promise<IcfResponse<T>> {
    return this.get(`/xslt/${encodeURIComponent(name)}`);
  }

  /** DELETE /xslt/<name> — delete an XSLT transformation program. */
  async deleteXslt<T>(name: string, body?: { transportRequest?: string }): Promise<IcfResponse<T>> {
    return this.request('delete', `/xslt/${encodeURIComponent(name)}`, body);
  }

  /** DELETE /tran/<tcode> — delete a transaction code (SE93). */
  async deleteTran<T>(tcode: string, body?: { transportRequest?: string }): Promise<IcfResponse<T>> {
    return this.request('delete', `/tran/${encodeURIComponent(tcode)}`, body);
  }

  /** GET /jobd/<name> — read an application job definition (SM36) as wire JSON. */
  async getJobd<T>(name: string): Promise<IcfResponse<T>> {
    return this.get(`/jobd/${encodeURIComponent(name)}`);
  }

  /** POST /jobd/<name> — create an application job definition.
   *  `package` and `transportRequest` are query parameters (the document has no
   *  package field). */
  async postJobd<T>(
    name: string,
    body: unknown,
    query: { package?: string; transportRequest?: string } = {},
  ): Promise<IcfResponse<T>> {
    return this.post(`/jobd/${encodeURIComponent(name)}${jobdQuery(query)}`, body);
  }

  /** PUT /jobd/<name> — update an existing application job definition. */
  async putJobd<T>(
    name: string,
    body: unknown,
    query: { transportRequest?: string } = {},
  ): Promise<IcfResponse<T>> {
    return this.put(`/jobd/${encodeURIComponent(name)}${jobdQuery(query)}`, body);
  }

  /** DELETE /jobd/<name> — delete an application job definition. */
  async deleteJobd<T>(
    name: string,
    query: { transportRequest?: string } = {},
  ): Promise<IcfResponse<T>> {
    return this.request('delete', `/jobd/${encodeURIComponent(name)}${jobdQuery(query)}`);
  }

  /** GET /sm59/<name> — read an SM59 HTTP destination (RFCTYPE=G) as wire JSON. */
  async getSm59<T>(name: string): Promise<IcfResponse<T>> {
    return this.get(`/sm59/${encodeURIComponent(name)}`);
  }

  /** POST /sm59/<name> — create or overwrite an SM59 HTTP destination. */
  async postSm59<T>(name: string, body: unknown): Promise<IcfResponse<T>> {
    return this.post(`/sm59/${encodeURIComponent(name)}`, body);
  }

  /** DELETE /sm59/<name> — delete an SM59 HTTP destination. */
  async deleteSm59<T>(name: string): Promise<IcfResponse<T>> {
    return this.request('delete', `/sm59/${encodeURIComponent(name)}`);
  }

  /**
   * DELETE an ICF JSON route that has no dedicated typed wrapper yet.
   *
   * The UCON object flows (SRFC / OA2P) build their route from the object type
   * spec, so a path-based escape hatch keeps the shared implementation honest
   * instead of duplicating two typed wrappers.
   */
  async deleteIcfRoute<T>(path: string, body?: unknown): Promise<IcfResponse<T>> {
    return this.request('delete', path, body);
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

  /** GET /version-source — active (00000) source of an object as transported to a remote system. */
  async getRemoteSource<T>(objectType: string, objectName: string, destination: string): Promise<IcfResponse<T>> {
    const qs = new URLSearchParams({ objectType, objectName, destination });
    return this.get(`/version-source?${qs.toString()}`);
  }

  /**
   * POST /data/query — read-only table data query.
   *
   * The SAP-side handler validates the request against DD02L/DD03L metadata,
   * parses the `where` clause, and executes a dynamic Open SQL statement with
   * value parameters bound separately (injection-safety contract: never string-
   * concatenate user input into the SQL).
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

  /**
   * reverse field lookup. POST /data/find-tables-by-fields.
   *
   * Body shape:
   *   {
   *     fields:     string[]   // 1..20 field names, uppercased server-side
   *     requireAll: boolean    // default true — every field must be in the table
   *     tabclass:   string?    // optional DDIC tabclass filter (TRANSP / VIEW / INTTAB)
   *     as4local:   string?    // default 'A' — active version
   *     limit:      number?    // default 200, hard cap 5000
   *   }
   *
   * Response shape:
   *   {
   *     status: 'success',
   *     data:   { total, truncated, mode, matches: [{ table, tabclass, hitCount, fields: [...] }] }
   *   }
   *
   * Backed by a single SELECT over DD03L joined to DD02L (TABCLASS), so the
   * cost is O(matching DD03L rows) instead of O(tables × fields). The hard
   * cap on `limit` (5000) protects against pathological fan-out (e.g.
   * searching for MANDT — every transparent table has it).
   */
  async postFindTablesByFields<T>(body: {
    fields: string[];
    requireAll?: boolean;
    tabclass?: string;
    as4local?: string;
    limit?: number;
    /** when true, SAP joins DD03T + DD04T to populate fieldText and
     *  elementText on each match. Default false (one-shot opt-in; the join
     *  adds ~2 left-queries per match set). */
    includeText?: boolean;
  }): Promise<IcfResponse<T>> {
    return this.post('/data/find-tables-by-fields', body);
  }

  /** Run one HTTP call and normalize transport errors into a CliError. */
  private async request<T>(method: 'get' | 'post' | 'put' | 'delete', path: string, body?: unknown): Promise<IcfResponse<T>> {
    try {
      const resp = await this.send<T>(method, path, body);
      return resp.data;
    } catch (error: unknown) {
      return this.normalizeError(error);
    }
  }

  /** Low-level send used by `request` (single attempt, no cookie fallback). */
  private async send<T>(method: 'get' | 'post' | 'put' | 'delete', path: string, body?: unknown): Promise<AxiosResponse<IcfResponse<T>>> {
    if (method === 'get') return this.http.get<IcfResponse<T>>(path);
    if (method === 'post') return this.http.post<IcfResponse<T>>(path, body);
    if (method === 'delete') return this.http.delete<IcfResponse<T>>(path, { data: body });
    return this.http.put<IcfResponse<T>>(path, body);
  }

  private normalizeError(error: unknown): never {
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

}

/** Query string for the JOBD route (package/transport request). */
function jobdQuery(query: { package?: string; transportRequest?: string }): string {
  const params = new URLSearchParams();
  if (query.package) params.set('package', query.package);
  if (query.transportRequest) params.set('transportRequest', query.transportRequest);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
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
