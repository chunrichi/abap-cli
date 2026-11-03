import { ADTClient, session_types, type ClientOptions, type TextElement, type TextElementCategory, type DumpsFeed, type UnitTestClass, type UnitTestRunFlags } from 'abap-adt-api';
import { parseServiceBinding, type ServiceBinding } from 'abap-adt-api/build/api/tablecontents.js';
import {
  buildActivationRequest,
  parseActivationResponse,
  resolveActivationOutcome,
  type ActivationEnforcementOptions,
  type ActivationItem,
} from './activation.js';
import { fetchDumpsFeed } from './dumps-feed.js';
import {
  getTextElements as adtGetTextElements,
  setTextElements as adtSetTextElements,
} from 'abap-adt-api/build/api/textelements.js';
import { AxiosHttpClient } from 'abap-adt-api/build/AxiosHttpClient.js';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { CONFIG_ERROR_REFERENCE } from '../config/recovery.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';
import { buildBasicAuth } from './basic-auth.js';
import { SessionLifecycle } from '../session/manager.js';
import { SessionHttpClient } from './session-http.js';
import { registerAdtClient } from '../session/registry.js';
import { buildCreateWire, type DevcCreateWireOptions } from '../formats/devc/json.js';
import {
  BDEF_BASE_PATH,
  BDEF_MEDIA_TYPE,
  bdefObjectUrl,
  buildBdefCreateBody,
} from './bdef.js';
import {
  PUBLISH_JOB_ACCEPT,
  SRVB_BASE_PATH,
  SRVB_MEDIA_TYPE,
  buildSrvbCreateBody,
  parsePublishJobResponse,
  publishJobAsXmlType,
  type PublishJobResult,
} from './srvb.js';
import { ATC_TYPE_INFO, atcMediaType, atcObjectUrl, buildAtcBody } from './atc.js';
import {
  CDS_TECH_INFO,
  buildCdsTechCreateBody,
  cdsTechObjectUrl,
  cdsTechSourceUrl,
} from './cds-tech.js';
import type { SrvbLocal } from '../formats/srvb/json.js';
import type { AtcLocal, AtcType } from '../formats/atc/json.js';
import type { CdsTechType } from '../formats/cds-tech/json.js';

/** ADT media type of a single package resource. */
const PACKAGE_MEDIA_TYPE = 'application/vnd.sap.adt.packages.v2+xml';

/** Best-effort HTTP status extraction from an `abap-adt-api` request error. */
function httpStatusOf(error: unknown): number | undefined {
  const asHttp = error as { err?: unknown; status?: unknown; response?: { status?: unknown } };
  if (typeof asHttp.err === 'number') return asHttp.err;
  if (typeof asHttp.status === 'number') return asHttp.status;
  const status = asHttp.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Inputs for `POST /sap/bc/adt/packages/validation` (package name preflight). */
export interface PackageValidationOptions {
  name: string;
  description: string;
  /** Super package. */
  parentName: string;
  softwareComponent: string;
  transportLayer: string;
  packageType: 'development' | 'main' | 'structure';
}

/** Outcome of the package name preflight (SAP reports rejects as HTTP 200). */
export interface PackageValidationResult {
  success: boolean;
  /** Raw `SEVERITY` value: `OK` / `ERROR`. */
  severity: string;
  message: string;
  longText?: string;
}

/** ADT package resource URL; namespace `/NS/NAME` names are percent-encoded. */
function packageUrl(name: string): string {
  return `/sap/bc/adt/packages/${encodeURIComponent(name)}`;
}

/**
 * Re-classify a 404 package response as `OBJECT_NOT_FOUND`.
 *
 * `classifyHttpError` maps every non-auth HTTP status to `SAP_ERROR`; a
 * missing package is a NOT_FOUND (exit 8) and callers branch on it.
 */
function mapPackageNotFound(error: unknown, name: string, action: 'read' | 'delete'): unknown {
  const asHttp = error as { err?: unknown; status?: unknown; message?: string };
  const status = typeof asHttp.err === 'number' ? asHttp.err : asHttp.status;
  if (status !== 404) return error;
  return new CliError('OBJECT_NOT_FOUND', `Package ${name} not found${asHttp.message ? `: ${asHttp.message}` : ''}`, {
    object: name,
    type: 'DEVC',
    nextSteps: [
      'Verify the package name: `abap search <name> --type DEVC`.',
      'Confirm the active system: `abap profile test <name>`.',
    ],
    example: action === 'read' ? `abap pull ${name} --type DEVC` : `abap delete ${name} --type DEVC --yes`,
  });
}

/**
 * Thin wrapper around abap-adt-api ADTClient.
 * Initializes from project config and exposes the most common operations.
 *
 * Authentication is basic auth: username + the keychain password, with TLS
 * trust options built by `buildBasicAuth`.
 *
 * Every method that round-trips to the ADT endpoint runs through `_call`,
 * which classifies TLS / AUTH / SAP errors via the shared HTTP classifier.
 */
export class AdtClientWrapper {
  private client: ADTClient;
  private config: ProjectConfig;
  private lifecycle: SessionLifecycle;

  private constructor(config: ProjectConfig, auth: { password: string; options: ClientOptions }, lifecycle: SessionLifecycle) {
    this.config = config;
    this.lifecycle = lifecycle;
    // The custom HTTP client owns cookie injection/capture; the library's
    // private cookie map is never touched (see clients/session-http.ts).
    const http = new SessionHttpClient(new AxiosHttpClient(config.sap.url, auth.options), lifecycle.controller);
    this.client = new ADTClient(
      http,
      config.sap.username,
      auth.password,
      config.sap.client,
      config.sap.language,
      auth.options,
    );
    this.client.stateful = session_types.stateful;
  }

  /**
   * Force a fresh login now (used by flows that need to authenticate before
   * a probe, e.g. runtime-probe / probe). Distinct from the lazy session
   * path in `_call`: it logs in directly and captures the session for reuse.
   */
  async login(): Promise<void> {
    await this._loginNow();
  }

  /**
   * Keep the SAP session mode in sync with what the login produced. Some
   * systems hand out `sap-contextid` plus `SAP_SESSIONID_*`; stateful mode is
   * kept whenever a real session cookie exists (otherwise every lock-requiring
   * operation fails with the library's `STATELESS` error). Only a login that
   * produced no session at all degrades to stateless.
   */
  private applySessionMode(): void {
    this.client.stateful = this.lifecycle.controller.hasStatefulSession()
      ? session_types.stateful
      : session_types.stateless;
  }

  private async _loginNow(): Promise<void> {
    try {
      this.lifecycle.beginFreshLogin();
      await this.client.login();
      this.applySessionMode();
      await this.lifecycle.adoptFreshLogin(this.client);
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      throw classifyHttpError(error, { name: this.config.systemName });
    }
  }

  static async create(): Promise<AdtClientWrapper> {
    try {
      const config = await loadConfig();
      const auth = buildBasicAuth(config.sap);
      const lifecycle = await SessionLifecycle.init(config);
      const wrapper = new AdtClientWrapper(config, auth, lifecycle);
      lifecycle.applyTo(wrapper.client);
      registerAdtClient(wrapper);
      return wrapper;
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', message, {
        nextSteps: [
          'Check the bound profile: abap profile list --json',
          'Re-bind the workspace: abap init --profile <name>',
        ],
        example: 'abap init --profile dev',
        references: CONFIG_ERROR_REFERENCE,
      });
    }
  }

  /** Effective session policy of this client (`reuse` or `always-logout`). */
  get sessionPolicy(): 'reuse' | 'always-logout' {
    return this.lifecycle.policy;
  }

  /** True when this wrapper reused a persisted SAP session (cookie jar). */
  get reusedSession(): boolean {
    return this.lifecycle.reused;
  }

  /**
   * True when this process opened a SAP session that the next command cannot
   * reuse (no durable store, blocked reuse, persistence failure). The
   * end-of-command hook releases such sessions so a degraded reuse path cannot
   * leave one orphan session per command.
   */
  get sessionNeedsRelease(): boolean {
    return this.lifecycle.needsRelease;
  }

  /** Lazy fresh login + capture/persist of the new session (first real call). */
  private async ensureSession(): Promise<void> {
    if (this.lifecycle.hasEstablishedSession) return;
    await this._loginNow();
  }

  /**
   * Explicit logout — used by the end-of-command lifecycle and by the
   * SIGINT/SIGTERM handlers. Best-effort: never throws to the caller.
   */
  async logout(): Promise<void> {
    await this.lifecycle.release(this.client);
  }

  get raw(): ADTClient {
    return this.client;
  }

  getConfig(): ProjectConfig {
    return this.config;
  }

  /**
   * Run an ADT call; if the underlying client throws, classify the error
   * (TLS / AUTH / SAP) and rethrow as a `CliError`. Existing CliError instances
   * pass through untouched so callers (push-flow, resolve) keep their
   * fine-grained sub-codes (LOCK_FAILED, OBJECT_NOT_FOUND, etc.).
   *
   * Session handling hooks here (single choke point for every round-trip):
   *   - first call on a fresh wrapper triggers `ensureSession()` (login +
   *     capture/persist when in reuse mode);
   *   - a stale-jar 401 in reuse mode triggers one fallback re-login then
   *     retries the original call once.
   */
  private async _call<T>(fn: () => Promise<T>): Promise<T> {
    const attempt = async (): Promise<T> => {
      await this.ensureSession();
      return fn();
    };
    try {
      const result = await attempt();
      this.lifecycle.markReuseSuccess();
      return result;
    } catch (error: unknown) {
      const classified = error instanceof CliError ? error : classifyHttpError(error, { name: this.config.systemName });
      if (classified.code === 'AUTH_ERROR' && this.lifecycle.recordAuthFailure()) {
        // Stale session: re-login, re-capture, persist, then retry once.
        await this._loginNow();
        try {
          const result = await attempt();
          this.lifecycle.markReuseSuccess();
          return result;
        } catch (retryError: unknown) {
          if (retryError instanceof CliError) throw retryError;
          throw classifyHttpError(retryError, { name: this.config.systemName });
        }
      }
      throw classified;
    }
  }

  /**
   * Low-level transport access for callers that issue raw ADT requests
   * (e.g. dumps-feed). Guarantees the session is ready before exposing it.
   */
  async ensureTransport(): Promise<ADTClient> {
    await this.ensureSession();
    return this.client;
  }

  // --- Object operations ---

  searchObject(query: string, objType?: string, maxResults = 100) {
    return this._call(() => this.client.searchObject(query, objType, maxResults));
  }

  getObjectSource(objectSourceUrl: string) {
    return this._call(() => this.client.getObjectSource(objectSourceUrl));
  }

  /** Active (compiled) version of an object source — routed through `_call`. */
  getActiveObjectSource(objectSourceUrl: string) {
    return this._call(() => this.client.getObjectSource(objectSourceUrl, { version: 'active' }));
  }

  /** Where-used: direct references to an object (ADT usageReferences). */
  usageReferences(objectUrl: string, line?: number, column?: number) {
    return this._call(() => this.client.usageReferences(objectUrl, line, column));
  }

  setObjectSource(objectSourceUrl: string, source: string, lockHandle: string, transport?: string) {
    return this._call(() => this.client.setObjectSource(objectSourceUrl, source, lockHandle, transport));
  }

  // --- dual-channel ADT endpoints (TTYP / MSAG / DDLS) ---

  /** GET /sap/bc/adt/ddic/tabletypes/<name> — retrieve a TTYP (table type).
   *  Returns the XML body verbatim; the caller (formats/ttyp/json.ts#wireToLocal)
   *  maps the wire to the local AFF nested shape. */
  getTtyp(name: string): Promise<string> {
    return this._call(async () => {
      const url = `/sap/bc/adt/ddic/tabletypes/${name.toUpperCase()}`;
      // DDIC atom endpoints reject narrow Accept types (406); fall back
      // to a wildcard that the SAP gateway accepts while we wait for the
      // canonical vnd.sap.adt.* content type registration.
      const resp = await this.client.httpClient.request(url, {
        method: 'GET',
        headers: { Accept: 'application/*' },
      });
      return String(resp.body);
    });
  }

  /** POST /sap/bc/adt/ddic/tabletypes — create a new TTYP object.
   *
   * The collection POST only registers the object with default content; the
   * row type / access type / keys are applied by a follow-up PUT (see
   * `flows/edit/ttyp-adt.ts`). `body` must therefore carry the
   * `adtcore:packageRef` for the create request.
   */
  createTtyp(body: string, transport?: string): Promise<void> {
    return this._call(async () => {
      await this.client.httpClient.request('/sap/bc/adt/ddic/tabletypes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.sap.adt.tabletype.v1+xml',
          Accept: 'application/*',
        },
        qs: {
          ...(transport ? { corrNr: transport } : {}),
        },
        body,
      });
    });
  }

  /** PUT /sap/bc/adt/ddic/tabletypes/<name> — overwrite an existing TTYP.
   *
   * ADT expects the lock handle / transport as query parameters and the
   * vendor media type (`application/vnd.sap.adt.tabletype.v1+xml`); a plain
   * `application/xml` PUT is rejected with 415.
   */
  updateTtyp(name: string, body: string, lockHandle: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/ddic/tabletypes/${name.toUpperCase()}`;
      await this.client.httpClient.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/vnd.sap.adt.tabletype.v1+xml',
          Accept: 'application/*',
        },
        qs: {
          ...(lockHandle ? { lockHandle } : {}),
          ...(transport ? { corrNr: transport } : {}),
        },
        body,
      });
    });
  }

  /** GET /sap/bc/adt/messageclass/<name> — retrieve a MSAG (message class). */
  getMsag(name: string): Promise<string> {
    return this._call(async () => {
      const url = `/sap/bc/adt/messageclass/${name.toUpperCase()}`;
      const resp = await this.client.httpClient.request(url, {
        method: 'GET',
        headers: { Accept: 'application/*' },
      });
      return String(resp.body);
    });
  }

  /** POST /sap/bc/adt/messageclass — create a new MSAG (header only).
   *
   * The ADT creation endpoint takes name / description / language / package
   * and silently drops any `mc:messages` in the body, so callers write the
   * message texts with a follow-up PUT (see `flows/edit/msag-adt.ts`).
   */
  createMsag(
    name: string,
    meta: { packageName: string; description: string; language?: string; transport?: string },
  ): Promise<void> {
    return this.createObject({
      objtype: 'MSAG/N',
      name: name.toUpperCase(),
      parentName: meta.packageName,
      parentPath: '',
      description: meta.description,
      ...(meta.language ? { language: meta.language, masterLanguage: meta.language } : {}),
      ...(meta.transport ? { transport: meta.transport } : {}),
    });
  }

  /** PUT /sap/bc/adt/messageclass/<name> — overwrite an existing MSAG.
   *
   * ADT expects the lock handle and the transport as query parameters
   * (`?lockHandle=&corrNr=`); sending them as headers makes SAP answer
   * "Parameter lockHandle could not be found".
   */
  updateMsag(name: string, xml: string, lockHandle: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/messageclass/${name.toUpperCase()}`;
      await this.client.httpClient.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/*',
        },
        qs: {
          ...(lockHandle ? { lockHandle } : {}),
          ...(transport ? { corrNr: transport } : {}),
        },
        body: xml,
      });
    });
  }

  /** GET /sap/bc/adt/ddic/ddl/sources/<name> — retrieve a DDLS (CDS view).
   *  The bare endpoint returns the metadata envelope (`<ddl:ddlSource>` with
   *  atom:link rel=source); the actual DDL body lives at the `<sourceUri>`-
   *  derived path (`/source/main`). We fetch both and return them split. */
  getDdls(name: string): Promise<{ xml: string; source: string }> {
    return this._call(async () => {
      const baseUrl = `/sap/bc/adt/ddic/ddl/sources/${name.toLowerCase()}`;
      const meta = await this.client.httpClient.request(baseUrl, {
        method: 'GET',
        headers: { Accept: 'application/*' },
      });
      const xml = String(meta.body);
      // Source endpoint — S/4 CDS consistently exposes it as `${baseUrl}/source/main`.
      // The wire rarely carries an inline ddlSourceString, so we always issue the
      // secondary fetch; this matches what the SAP GUI's "Show Source" pane reads.
      const sourceResp = await this.client.httpClient.request(`${baseUrl}/source/main`, {
        method: 'GET',
        headers: { Accept: 'text/plain' },
      }).catch((err: unknown) => ({ body: '' as string, status: 0, error: err }));
      const source = String(sourceResp.body ?? '');
      return { xml, source };
    });
  }

  /** POST /sap/bc/adt/ddic/ddl/sources — create a new DDLS (header only).
   *
   * The DDLS source lives at `<objectUrl>/source/main` and is written by a
   * locked PUT afterwards (see `writeDdlsSource`). The create request carries
   * the description in the logon language (ADT rejects a description language
   * that differs from the logon language) and the object's original language
   * as `masterLanguage`.
   */
  createDdls(
    name: string,
    meta: { packageName: string; description: string; originalLanguage?: string; transport?: string },
  ): Promise<void> {
    return this.createObject({
      objtype: 'DDLS/DF',
      name,
      parentName: meta.packageName,
      parentPath: `/sap/bc/adt/packages/${encodeURIComponent(meta.packageName)}`,
      description: meta.description,
      language: this.config.sap.language,
      masterLanguage: meta.originalLanguage ?? this.config.sap.language,
      ...(meta.transport ? { transport: meta.transport } : {}),
    });
  }

  /** Write the CDS source of an existing DDLS: lock → PUT source/main → unlock
   *  → activate. DDLS is a source object, so the write needs the lock handle in
   *  the query string and a text/plain body. */
  writeDdlsSource(name: string, source: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const objectUrl = `/sap/bc/adt/ddic/ddl/sources/${name.toLowerCase()}`;
      const lock = await this.lock(objectUrl);
      const handle = lock.LOCK_HANDLE;
      try {
        await this.client.httpClient.request(`${objectUrl}/source/main`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            Accept: 'application/*',
          },
          qs: {
            ...(handle ? { lockHandle: handle } : {}),
            ...(transport ? { corrNr: transport } : {}),
          },
          body: source,
        });
      } finally {
        await this.unLock(objectUrl, handle).catch(() => undefined);
      }
      await this.activate(objectUrl, 'DDLS/DF', name);
    });
  }

  /**
   * Create a BDEF header via the ADT blueSource endpoint.
   *
   * `abap-adt-api` has no BDEF entry in its typed `CreatableTypeIds`, so the
   * CLI posts the body itself (see `clients/bdef.ts`). The header is inactive
   * until `writeBdefSource` writes the `.abdl` body and activates it.
   */
  createBdef(
    name: string,
    meta: { packageName: string; description: string; originalLanguage?: string; transport?: string },
  ): Promise<void> {
    return this._call(async () => {
      const body = buildBdefCreateBody({
        name,
        packageName: meta.packageName,
        description: meta.description,
        originalLanguage: meta.originalLanguage,
        language: this.config.sap.language,
      });
      await this.client.httpClient.request(BDEF_BASE_PATH, {
        method: 'POST',
        body,
        headers: { 'Content-Type': BDEF_MEDIA_TYPE, Accept: BDEF_MEDIA_TYPE },
        qs: meta.transport ? { corrNr: meta.transport } : {},
      });
    });
  }

  /** Write the `.abdl` source of an existing BDEF: lock → PUT source/main →
   *  unlock → activate. Same lifecycle as DDLS, against the blueSource URL. */
  writeBdefSource(name: string, source: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const objectUrl = bdefObjectUrl(name);
      const lock = await this.lock(objectUrl);
      const handle = lock.LOCK_HANDLE;
      try {
        await this.client.httpClient.request(`${objectUrl}/source/main`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            Accept: 'text/plain',
          },
          qs: {
            ...(handle ? { lockHandle: handle } : {}),
            ...(transport ? { corrNr: transport } : {}),
          },
          body: source,
        });
      } finally {
        await this.unLock(objectUrl, handle).catch(() => undefined);
      }
      await this.activate(objectUrl, 'BDEF/BDO', name);
    });
  }

  /**
   * Create a service binding from the AFF document.
   *
   * `abap-adt-api`'s typed creator hard-codes category 0 / version V2, so the
   * CLI builds the body itself. The binding becomes usable only after
   * activation (ADR-created bindings report `bindingCreated="false"` until
   * then).
   */
  createSrvb(
    name: string,
    doc: SrvbLocal,
    meta: { packageName: string; transport?: string },
  ): Promise<void> {
    return this._call(async () => {
      const body = buildSrvbCreateBody(doc, {
        name,
        packageName: meta.packageName,
        language: this.config.sap.language,
      });
      await this.client.httpClient.request(SRVB_BASE_PATH, {
        method: 'POST',
        body,
        headers: { 'Content-Type': SRVB_MEDIA_TYPE, Accept: SRVB_MEDIA_TYPE },
        qs: meta.transport ? { corrNr: meta.transport } : {},
      });
    });
  }

  // --- ATC configuration objects (CHKC / CHKO / CHKV) ---

  /**
   * Read the raw XML of one ATC configuration object.
   *
   * The three ADT resources are versioned XML envelopes; the caller projects
   * them onto the AFF document with `parseAtcObject`. `abap-adt-api` has no
   * endpoint for these types, so the request goes through the session HTTP
   * client directly.
   */
  getAtcObject(type: AtcType, name: string): Promise<string> {
    return this._call(async () => {
      const response = await this.client.httpClient.request(atcObjectUrl(type, name), {
        method: 'GET',
        headers: { Accept: atcMediaType(type) },
      });
      return String(response.body ?? '');
    });
  }

  /**
   * Create an ATC configuration object (POST collection → inactive object).
   *
   * The object stays inactive until the caller activates it; `create-atc.ts`
   * owns that split so `--no-activate` can stop after the write.
   */
  createAtcObject(
    type: AtcType,
    name: string,
    doc: AtcLocal,
    meta: { packageName: string; transport?: string },
  ): Promise<void> {
    return this._call(async () => {
      const body = buildAtcBody(type, name, doc, {
        packageName: meta.packageName,
        language: this.config.sap.language,
      });
      await this.client.httpClient.request(ATC_TYPE_INFO[type].basePath, {
        method: 'POST',
        body,
        headers: { 'Content-Type': atcMediaType(type), Accept: atcMediaType(type) },
        qs: meta.transport ? { corrNr: meta.transport } : {},
      });
    });
  }

  /**
   * Update an existing ATC configuration object: lock → PUT resource →
   * unlock. Activation is a separate step because a failed activation must
   * still release the lock and surface as "written but inactive".
   */
  updateAtcObject(
    type: AtcType,
    name: string,
    doc: AtcLocal,
    meta: { packageName?: string; transport?: string },
  ): Promise<void> {
    return this._call(async () => {
      const objectUrl = atcObjectUrl(type, name);
      const lock = await this.lock(objectUrl);
      const handle = lock.LOCK_HANDLE;
      try {
        const body = buildAtcBody(type, name, doc, {
          ...(meta.packageName ? { packageName: meta.packageName } : {}),
          language: this.config.sap.language,
        });
        await this.client.httpClient.request(objectUrl, {
          method: 'PUT',
          headers: { 'Content-Type': atcMediaType(type), Accept: atcMediaType(type) },
          qs: {
            ...(handle ? { lockHandle: handle } : {}),
            ...(meta.transport ? { corrNr: meta.transport } : {}),
          },
          body,
        });
      } finally {
        await this.unLock(objectUrl, handle).catch(() => undefined);
      }
    });
  }

  // --- CDS technical objects (DTDC / DTEB / DSFD / DSFI) ---

  /** Read the metadata XML of one CDS technical object. */
  getCdsTechObject(type: CdsTechType, name: string): Promise<string> {
    return this._call(async () => {
      const response = await this.client.httpClient.request(cdsTechObjectUrl(type, name), {
        method: 'GET',
        headers: { Accept: CDS_TECH_INFO[type].metaMediaType },
      });
      return String(response.body ?? '');
    });
  }

  /** Read `source/main` — `.acds` text for DTDC/DTEB/DSFD, AFF JSON for DSFI. */
  getCdsTechSource(type: CdsTechType, name: string): Promise<string> {
    return this._call(async () => {
      const response = await this.client.httpClient.request(cdsTechSourceUrl(type, name), {
        method: 'GET',
        // The source resource accepts `text/plain` / `application/json`
        // without parameters; sending the charset-bearing Content-Type value
        // as Accept makes SAP answer 406.
        headers: { Accept: type === 'DSFI' ? 'application/json' : 'text/plain' },
      });
      return String(response.body ?? '');
    });
  }

  /**
   * Create a CDS technical object (POST collection → inactive object). The
   * source is written afterwards with {@link writeCdsTechSource}; activation
   * stays with the caller so `--no-activate` can stop after the write.
   */
  createCdsTechObject(
    type: CdsTechType,
    name: string,
    meta: { packageName: string; description: string; transport?: string },
  ): Promise<void> {
    return this._call(async () => {
      const body = buildCdsTechCreateBody(type, name, {
        packageName: meta.packageName,
        description: meta.description,
        language: this.config.sap.language,
      });
      await this.client.httpClient.request(CDS_TECH_INFO[type].collection, {
        method: 'POST',
        body,
        headers: { 'Content-Type': CDS_TECH_INFO[type].createMediaType, Accept: '*/*' },
        qs: meta.transport ? { corrNr: meta.transport } : {},
      });
    });
  }

  /**
   * Write `source/main`: lock → PUT → unlock. DSFI sends the AFF JSON document
   * (its source *is* the JSON), the other three send the `.acds` CDS source.
   */
  writeCdsTechSource(
    type: CdsTechType,
    name: string,
    source: string,
    meta: { transport?: string; description?: string } = {},
  ): Promise<void> {
    return this._call(async () => {
      const objectUrl = cdsTechObjectUrl(type, name);
      const sourceUrl = cdsTechSourceUrl(type, name);
      const lock = await this.lock(objectUrl);
      const handle = lock.LOCK_HANDLE;
      try {
        await this.client.httpClient.request(sourceUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': CDS_TECH_INFO[type].sourceMediaType,
            Accept: type === 'DSFI' ? 'application/json' : 'text/plain',
          },
          qs: {
            ...(handle ? { lockHandle: handle } : {}),
            ...(meta.transport ? { corrNr: meta.transport } : {}),
          },
          body: source,
        });
        // The AFF header description lives in the object metadata, not in the
        // source resource: sync it under the same lock so a pull → edit →
        // push round-trip keeps the description. The metadata PUT marks the
        // object inactive again; the caller activates afterwards.
        if (meta.description !== undefined) {
          const metadataBody = buildCdsTechCreateBody(type, name, {
            description: meta.description,
            language: this.config.sap.language,
          });
          await this.client.httpClient.request(objectUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': CDS_TECH_INFO[type].metaMediaType,
              Accept: CDS_TECH_INFO[type].metaMediaType,
            },
            qs: {
              ...(handle ? { lockHandle: handle } : {}),
              ...(meta.transport ? { corrNr: meta.transport } : {}),
            },
            body: metadataBody,
          });
        }
      } finally {
        await this.unLock(objectUrl, handle).catch(() => undefined);
      }
    });
  }

  /**
   * Publish or unpublish an OData service binding.
   *
   * ADT uses `/businessservices/{odatav2|odatav4}/{un,}publishjobs` with the
   * binding name + service version in the query string. On-prem renders the
   * status only as `application/vnd.sap.as+xml`; a 406/415 is retried once with
   * the fully-qualified media type (same pattern as the Eclipse ADT client).
   */
  publishSrvb(
    name: string,
    serviceVersion: string,
    bindingVersion: string,
    unpublish = false,
  ): Promise<PublishJobResult> {
    return this._call(async () => {
      const serviceType = bindingVersion.toUpperCase() === 'V2' ? 'odatav2' : 'odatav4';
      const job = unpublish ? 'unpublishjob' : 'publishjob';
      const action = unpublish ? 'unpublishjobs' : 'publishjobs';
      const url =
        `/sap/bc/adt/businessservices/${serviceType}/${action}` +
        `?servicename=${encodeURIComponent(name)}&serviceversion=${encodeURIComponent(serviceVersion)}`;
      const body =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
        `<adtcore:objectReference adtcore:name="${name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"/>` +
        '</adtcore:objectReferences>';
      const request = (contentType: string, accept: string) =>
        this.client.httpClient.request(url, {
          method: 'POST',
          body,
          headers: { 'Content-Type': contentType, Accept: accept },
        });
      let response: { body?: unknown };
      try {
        response = (await request('application/xml', PUBLISH_JOB_ACCEPT)) as { body?: unknown };
      } catch (error: unknown) {
        const status = httpStatusOf(error);
        if (status !== 406 && status !== 415) throw error;
        const asXmlType = publishJobAsXmlType(serviceType, job);
        response = (await request(asXmlType, asXmlType)) as { body?: unknown };
      }
      const result = parsePublishJobResponse(String(response.body ?? ''));
      if (result.severity && result.severity.toUpperCase() !== 'OK') {
        throw new CliError(
          'SAP_ERROR',
          `Service binding ${name} ${unpublish ? 'unpublish' : 'publish'} failed: ${result.shortText || 'SAP returned an error'}` +
            (result.longText ? ` (${result.longText})` : ''),
          {
            details: {
              object: name,
              severity: result.severity,
              shortText: result.shortText,
              longText: result.longText,
            },
          },
        );
      }
      return result;
    });
  }

  // --- Lock operations ---

  lock(objectUrl: string) {
    return this._call(() => this.client.lock(objectUrl));
  }

  unLock(objectUrl: string, lockHandle: string) {
    return this._call(() => this.client.unLock(objectUrl, lockHandle));
  }

  // --- Activation ---

  activate(objectUrl: string, _objectType: string, objectName: string, opts?: ActivationEnforcementOptions) {
    // Only uri + name are sent; see postActivation. Object type is accepted for
    // call-site compatibility but deliberately not emitted.
    return this.postActivation([{ uri: objectUrl, name: objectName }], opts);
  }

  /**
   * Activate a full list of inactive items (method/OSI source level).
   */
  activateAll(
    items: Array<{ uri: string; type: string; name: string; parentUri: string }>,
    opts?: ActivationEnforcementOptions,
  ) {
    return this.postActivation(items.map((i) => ({ uri: i.uri, name: i.name })), opts);
  }

  /**
   * POST /sap/bc/adt/activation with the object-reference shape real SAP honours.
   *
   * See `clients/activation.ts` for why `abap-adt-api`'s own `activate()` cannot
   * be used: it emits `adtcore:type` + `adtcore:parentUri`, which makes on-prem
   * SAP answer `activationExecuted="false"` — a silent no-op that leaves the
   * source written-but-inactive while callers see success. `opts.requireExecuted`
   * turns a remaining silent no-op into a hard failure (push path) after
   * checking whether a pending inactive version really exists; without it the
   * flag degrades to a warning (standalone `abap activate`).
   */
  private postActivation(items: ActivationItem[], opts?: ActivationEnforcementOptions) {
    return this._call(async () => {
      const response = await this.client.httpClient.request('/sap/bc/adt/activation', {
        body: buildActivationRequest(items),
        method: 'POST',
        qs: { method: 'activate', preauditRequested: true },
      });
      const result = parseActivationResponse(String(response.body ?? ''));
      const label = items.map((i) => i.name).join(', ');
      await resolveActivationOutcome(result, label, opts, async () => {
        // "Nothing to activate" (push of unchanged source) and "activation
        // skipped while a new version waits" share the same flags; only the
        // pending-inactive list tells them apart.
        let pending: boolean | undefined = false;
        for (const item of items) {
          const state = await this.pendingInactiveObject(item.uri);
          if (state === true) return true;
          if (state === undefined) pending = undefined;
        }
        return pending;
      });
      return result;
    });
  }

  /**
   * Is there a written-but-unactivated version of `objectUrl` for the current
   * user? `undefined` when the inactive-objects endpoint cannot be queried.
   */
  async pendingInactiveObject(objectUrl: string): Promise<boolean | undefined> {
    try {
      const list = (await this.client.inactiveObjects()) as Array<{
        object?: { 'adtcore:uri'?: string; deleted?: boolean };
      }>;
      const target = objectUrl.replace(/\/+$/, '').toLowerCase();
      return list.some((entry) => {
        const object = entry?.object;
        if (!object || object.deleted === true) return false;
        if (typeof object['adtcore:uri'] !== 'string') return false;
        return object['adtcore:uri'].replace(/\/+$/, '').toLowerCase() === target;
      });
    } catch {
      // Endpoint missing/forbidden on this release — the caller degrades to a
      // warning instead of claiming an activation state it cannot verify.
      return undefined;
    }
  }

  /** List inactive objects (edit sessions awaiting activation). */
  inactiveObjects() {
    return this._call(() => this.client.inactiveObjects());
  }

  // --- Number Range Objects (NROB) ---

  /**
   * Read a Number Range Object's source via the ADT `numberranges/objects`
   * collection.
   *
   * `abap-adt-api` does not expose NROB, so this goes through the raw HTTP
   * client (the same approach `clients/activation.ts` uses). The endpoint
   * returns the abap-file-format `nrob-v1.json` document verbatim — the
   * object's source *is* the AFF file, which is why no system-side format
   * helper is involved (unlike TABL/DOMA/DTEL, which are ICF-only).
   *
   * Not every system has this object type (the registry marks NROB with an
   * `icfFallback` for that reason), so callers should treat a failure here as
   * "try the ICF channel" rather than a hard error.
   *
   * **Read-only on NW 7.93 / S/4HANA** (2026-09-16 real-SAP probe): the
   * `numberranges/objects/{name}` collection accepts only GET. `POST` with
   * `_action=create` returns "Resource controller does not support method
   * create"; `PUT` returns "does not support method PUT". So the create /
   * push side of NROB has to stay on the bundled ICF `/ddic/nrob` route
   * (which writes the classic TNRO / TNROT / NRIV tables). Pull keeps the
   * ADT path because that's the canonical mirror on S/4HANA. Discovery XML
   * for the collection lives at `/sap/bc/adt/discovery` under the
   * `nrobnro` category.
   */
  readNrobSource(name: string) {
    return this._call(async () => {
      const response = await this.client.httpClient.request(
        `/sap/bc/adt/numberranges/objects/${encodeURIComponent(name)}/source/main`,
        { method: 'GET', headers: { Accept: '*/*' } },
      );
      return String(response.body ?? '');
    });
  }

  // --- Syntax check ---

  syntaxCheck(cdsUrl: string) {
    return this._call(() => this.client.syntaxCheck(cdsUrl));
  }

  /** Content-based syntax check: validates local content without saving it. */
  syntaxCheckContent(url: string, mainUrl: string, content: string, mainProgram?: string) {
    return this._call(() => this.client.syntaxCheck(url, mainUrl, content, mainProgram));
  }

  // --- Object structure ---

  objectStructure(objectUrl: string) {
    return this._call(() => this.client.objectStructure(objectUrl));
  }

  /** Structure elements for `inspect --structure`. */
  objectStructureElements(objectUrl: string, version?: Parameters<ADTClient['objectStructureElements']>[1]) {
    return this._call(() => this.client.objectStructureElements(objectUrl, version));
  }

  /**
   * Fetch the nested service-binding metadata omitted by
   * `objectStructure()`. Returns the parsed `ServiceBinding` payload
   * (services, binding type / category, packageRef, …) — the consumer
   * is responsible for projecting it into the AFF `<name>.srvb.json`
   * shape via `formats/pull-strategy.ts#renderServiceBindingMetadata`.
   *
   * abap-adt-api does not expose a typed `serviceBinding()` method,
   * so we round-trip through `httpClient.request()` and parse the
   * `application/vnd.sap.adt.businessservices.servicebinding.v2+xml` body
   * via the package's `parseServiceBinding`.
   */
  serviceBinding(objectUrl: string): Promise<ServiceBinding> {
    return this._call(async () => {
      const response = await this.client.httpClient.request(objectUrl, {
        method: 'GET',
        headers: { Accept: 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml' },
      });
      return parseServiceBinding(String(response.body));
    });
  }

  /**
   * Fetch the source DDL for a service definition (SRVD).
   * SRVD objects carry a DDL-like body (define service …) wrapped in
   * the standard ADT source envelope. abap-adt-api exposes the same
   * `getObjectSource` for every type, so this is a thin convenience
   * wrapper.
   */
  getSrvd(objectSourceUrl: string): Promise<string> {
    return this._call(() => this.client.getObjectSource(objectSourceUrl));
  }

  /**
   * Run an ABAP class as an application (ADT classrun, e.g. ICF setup).
   * optional second `params` argument forwards classrun input
   * as JSON body — the underlying abap-adt-api `runClass(name)` does
   * not accept body params, so this wrapper goes through `AdtHTTP.request`
   * with a JSON body when `params` is provided. The SAP-side wrapper reads
   * via `IF_OO_ADT_CLASSRUN~MAIN`. When `params` is omitted the existing
   * abap-adt-api path is used (deploy-flow still works).
   *
   * Body shape: { name: string, value: string }[]  →  JSON array (SAP
   * accepts arbitrary JSON body for classrun via /sap/bc/adt/oo/classrun/<name>).
   */
  async runClass(
    className: string,
    params?: Array<{ name: string; value: string }>,
  ): Promise<string> {
    if (!params) {
      return this._call(() => this.client.runClass(className));
    }
    // Wrapper path: POST with JSON body so the SAP-side wrapper reads
    // its inputs via the classrun body (IV_TARGET_CLASS / IV_METHOD_NAME /
    // IV_ARGS_JSON / IV_TIMEOUT_MS).
    return this._call(async () => {
      const response = await this.client.httpClient.request(
        `/sap/bc/adt/oo/classrun/${className.toUpperCase()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/plain',
          },
          body: JSON.stringify(params),
        },
      );
      return String(response.body);
    });
  }

  // --- Text elements ---

  /** Read text elements (symbols/selections/headings) for an object. */
  getTextElements(objectType: string, objectName: string, category: TextElementCategory = 'symbols') {
    return this._call(async () => {
      const url = this.textElementsUrlFor(objectType, objectName);
      return adtGetTextElements(this.client.httpClient, url, category);
    });
  }

  /** Write text elements. Caller is responsible for lock/unlock (push-flow). */
  setTextElements(
    objectType: string,
    objectName: string,
    category: TextElementCategory,
    elements: TextElement[],
    lockHandle: string,
    transport?: string,
  ) {
    return this._call(async () => {
      const url = this.textElementsUrlFor(objectType, objectName);
      return adtSetTextElements(this.client.httpClient, url, category, elements, lockHandle, transport);
    });
  }

  /** Synchronous URL builder (no round-trip); avoids double async for callers. */
  private textElementsUrlFor(objectType: string, objectName: string): string {
    const lower = objectName.toLowerCase();
    const encoded = lower.includes('/') ? encodeURIComponent(lower) : lower;
    const upperType = objectType.toUpperCase();
    if (upperType.startsWith('CLAS')) return `/sap/bc/adt/textelements/classes/${encoded}`;
    if (upperType.startsWith('FUGR')) return `/sap/bc/adt/textelements/functiongroups/${encoded}`;
    return `/sap/bc/adt/textelements/programs/${encoded}`;
  }

  /** Main program(s) for an include part (program/function-group includes). */
  mainPrograms(includeUrl: string) {
    return this._call(() => this.client.mainPrograms(includeUrl));
  }

  // --- Transport ---

  transportInfo(objSourceUrl: string, devClass?: string) {
    return this._call(() => this.client.transportInfo(objSourceUrl, devClass));
  }

  createTransport(objSourceUrl: string, requestText: string, devClass: string) {
    return this._call(() => this.client.createTransport(objSourceUrl, requestText, devClass));
  }

  userTransports(user: string, targets?: boolean) {
    return this._call(() => this.client.userTransports(user, targets));
  }

  /** Structured transport metadata for `transport show <req>`. */
  transportDetails(transportNumber: string) {
    return this._call(() => this.client.transportDetails(transportNumber));
  }

  /** Release a transport request. Destructive — a released request cannot be undone. */
  transportRelease(transportNumber: string, ignoreLocks?: boolean, ignoreATC?: boolean) {
    return this._call(() => this.client.transportRelease(transportNumber, ignoreLocks, ignoreATC));
  }

  /**
   * Raw GET of an ADT Atom feed (versions etc.) using the wrapper's
   * authenticated session; returns the XML body for the caller to parse.
   */
  adtFeed(feedPath: string) {
    return this._call(async () => {
      const response = await this.client.httpClient.request(feedPath, {
        headers: { Accept: 'application/atom+xml;type=feed' },
      });
      return response.body;
    });
  }

  // --- Object creation ---

  /**
   * Create a CLAS / INTF / PROG / FUGR using the wrapper at
   * `./create-object.ts` which sets `Content-Type: application/xml` (BTP / Steampunk
   * safe) instead of the library's `application/*`. Falls back to the upstream
   * library for unsupported types.
   *
   */
  createObject(options: Parameters<ADTClient['createObject']>[0]) {
    return this._call(async () => {
      const { createObjectSafe } = await import('./create-object.js');
      const responsible = this.config.sap.username.toUpperCase();
      await createObjectSafe(
        this.client.httpClient,
        {
          objtype: options.objtype,
          name: options.name,
          parentName: options.parentName,
          description: options.description,
          parentPath: options.parentPath,
          ...(options.transport ? { transport: options.transport } : {}),
          ...(options.language ? { language: options.language } : {}),
          ...(options.masterLanguage ? { masterLanguage: options.masterLanguage } : {}),
        },
        { responsible },
        () => this.client.createObject(options),
      );
    });
  }

  /** Validate a proposed object without creating it (`create --check-only`). */
  validateNewObject(options: Parameters<ADTClient['validateNewObject']>[0]) {
    return this._call(() => this.client.validateNewObject(options));
  }

  // --- Packages (DEVC) ---

  /**
   * GET `/sap/bc/adt/packages/<name>` and return the `pak:package` XML
   * verbatim. The caller maps it to the local AFF document
   * (`formats/devc/json.ts#wireToLocal`).
   */
  getPackage(name: string): Promise<string> {
    return this._call(async () => {
      try {
        const response = await this.client.httpClient.request(packageUrl(name), {
          method: 'GET',
          headers: { Accept: PACKAGE_MEDIA_TYPE },
        });
        return String(response.body ?? '');
      } catch (error: unknown) {
        throw mapPackageNotFound(error, name, 'read');
      }
    });
  }

  /**
   * Preflight a package creation (`create DEVC --check-only`).
   *
   * `POST /sap/bc/adt/packages/validation` answers an `asx:abap` envelope with
   * `SEVERITY` (`OK` / `ERROR`) and `SHORT_TEXT`. SAP reports a rejected name
   * as a *successful* HTTP response, so the caller decides based on `success`.
   */
  validatePackage(options: PackageValidationOptions): Promise<PackageValidationResult> {
    return this._call(async () => {
      const response = await this.client.httpClient.request('/sap/bc/adt/packages/validation', {
        method: 'POST',
        qs: {
          objtype: 'DEVC/K',
          objname: options.name,
          description: options.description,
          packagename: options.parentName,
          swcomp: options.softwareComponent,
          transportLayer: options.transportLayer,
          packagetype: options.packageType,
        },
        headers: { Accept: 'application/*' },
      });
      const xml = String(response.body ?? '');
      const severity = /<SEVERITY>([^<]*)<\/SEVERITY>/.exec(xml)?.[1]?.trim() ?? '';
      const message = /<SHORT_TEXT>([^<]*)<\/SHORT_TEXT>/.exec(xml)?.[1]?.trim() ?? '';
      const longText = /<LONG_TEXT>([^<]*)<\/LONG_TEXT>/.exec(xml)?.[1]?.trim() ?? '';
      return {
        success: severity !== 'ERROR' && severity !== 'A' && severity !== 'X',
        severity,
        message: message || longText,
        longText,
      };
    });
  }

  /**
   * POST `/sap/bc/adt/packages` to create a package (`DEVC/K`).
   *
   * The request body carries the super package in both `adtcore:packageRef`
   * and `pak:superPackage`; `pak:transport` carries the software component and
   * transport layer. Errors bubble up as classified CliErrors — the flow adds
   * the object context.
   */
  createPackage(options: DevcCreateWireOptions & { transport?: string }): Promise<void> {
    return this._call(async () => {
      await this.client.httpClient.request('/sap/bc/adt/packages', {
        method: 'POST',
        ...(options.transport ? { qs: { corrNr: options.transport } } : {}),
        headers: { 'Content-Type': 'application/*', Accept: 'application/*' },
        body: buildCreateWire(options),
      });
    });
  }

  /**
   * DELETE `/sap/bc/adt/packages/<name>`.
   *
   * Packages are deleted *without* a prior lock: `DELETE` with a lock handle
   * is rejected by SAP with "package is locked". `transport` is forwarded as
   * `corrNr` for transportable packages.
   */
  deletePackage(name: string, transport?: string): Promise<void> {
    return this._call(async () => {
      try {
        await this.client.httpClient.request(packageUrl(name), {
          method: 'DELETE',
          ...(transport ? { qs: { corrNr: transport } } : {}),
          headers: { Accept: 'application/*' },
        });
      } catch (error: unknown) {
        throw mapPackageNotFound(error, name, 'delete');
      }
    });
  }

  // --- Deletion ---

  deleteObject(objectUrl: string, lockHandle: string, transport?: string) {
    return this._call(() => this.client.deleteObject(objectUrl, lockHandle, transport));
  }

  // --- ATC (check atc) ---

  atcCheckVariant(variant: string) {
    return this._call(() => this.client.atcCheckVariant(variant));
  }

  createAtcRun(variant: string, mainUrl: string, maxResults = 100) {
    return this._call(() => this.client.createAtcRun(variant, mainUrl, maxResults));
  }

  atcWorklists(runResultId: string, timestamp?: number, usedObjectSet?: string, includeExemptedFindings = false) {
    return this._call(() =>
      timestamp === undefined
        ? this.client.atcWorklists(runResultId)
        : this.client.atcWorklists(runResultId, timestamp, usedObjectSet ?? '', includeExemptedFindings),
    );
  }

  // --- ABAP Unit (test) ---

  /**
   * Run ABAP Unit for one object via the ADT ABAP Unit endpoint
   * (`POST /sap/bc/adt/abapunit/testruns`).
   *
   * `objectUrl` is the semantic object reference returned by
   * `resolveObject` (e.g. `/sap/bc/adt/oo/classes/zcl_foo`); `flags` selects
   * the risk + duration levels of the run configuration. Read-only: an ABAP
   * Unit run neither locks objects nor creates transports.
   */
  unitTestRun(objectUrl: string, flags?: UnitTestRunFlags): Promise<UnitTestClass[]> {
    return this._call(() => this.client.unitTestRun(objectUrl, flags));
  }

  // --- Runtime dumps (read-only) ---

  /**
   * List recent ST22 ABAP runtime dumps via the ADT Atom feed
   * `/sap/bc/adt/runtime/dumps`. Read-only — never creates locks, transports,
   * or SAP data. `$top` / `$filter` are sent as direct OData URL parameters so
   * the server trims the result set before it reaches the CLI.
   */
  dumps(limit?: number, user?: string): Promise<DumpsFeed> {
    return this._call(() => fetchDumpsFeed(this.client.httpClient, limit, user));
  }
}
