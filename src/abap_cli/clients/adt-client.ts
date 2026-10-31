import { ADTClient, session_types, type ClientOptions, type TextElement, type TextElementCategory, type DumpsFeed, type UnitTestClass, type UnitTestRunFlags } from 'abap-adt-api';
import { parseServiceBinding, type ServiceBinding } from 'abap-adt-api/build/api/tablecontents.js';
import {
  buildActivationRequest,
  enforceActivationOutcome,
  parseActivationResponse,
  type ActivationEnforcementOptions,
  type ActivationItem,
} from './activation.js';
import { fetchDumpsFeed } from './dumps-feed.js';
import {
  getTextElements as adtGetTextElements,
  setTextElements as adtSetTextElements,
} from 'abap-adt-api/build/api/textelements.js';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { CONFIG_ERROR_REFERENCE } from '../config/recovery.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';
import { buildBasicAuth } from './basic-auth.js';
import { makeEmptyJar, type SessionJar } from '../session/jar.js';
import { effectivePolicy, isUnsupportedInContext, resolveSessionPolicy } from '../session/policy.js';
import { loadOrCreateSessionKey } from '../session/key.js';
import {
  captureSessionFromAdt,
  clearJarFromDisk,
  injectSessionIntoAdt,
  loadJarFromDisk,
  markJarPersisted,
  shouldDegradeToStateless,
} from '../session/reuse.js';
import { registerAdtClient } from '../session/registry.js';
import { buildCreateWire, type DevcCreateWireOptions } from '../formats/devc/json.js';

/** ADT media type of a single package resource. */
const PACKAGE_MEDIA_TYPE = 'application/vnd.sap.adt.packages.v2+xml';

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

  /** Effective session policy (`reuse` / `always-logout`) after env/config resolution. */
  private policy: 'reuse' | 'always-logout' = 'reuse';
  /** Loaded jar in reuse mode; `null` when fresh login is required. */
  private jar: SessionJar | null = null;
  /** 32-byte AES key for jar persistence (reuse mode only). */
  private sessionKey: Buffer | null = null;
  /** True once the session is ready (reused OR fresh-logged-in). */
  private sessionReady = false;
  /** True once a 401 fallback re-login has been attempted. */
  private fallbackUsed = false;
  /** True once this process opened a SAP session itself (fresh login). */
  private freshLogin = false;
  /** True when the live session is persisted for the next command to reuse. */
  private sessionReusable = false;

  private constructor(config: ProjectConfig, auth: { password: string; options: ClientOptions }) {
    this.config = config;
    this.client = new ADTClient(
      this.config.sap.url,
      this.config.sap.username,
      auth.password,
      this.config.sap.client,
      this.config.sap.language,
      auth.options,
    );
    this.client.stateful = session_types.stateful;
  }

  /**
   * Force a fresh login now (used by flows that need to authenticate before
   * a probe, e.g. runtime-probe / probe). Distinct from the lazy session
   * path in `_call`: it logs in directly and captures the session into the
   * jar when in reuse mode.
   */
  async login(): Promise<void> {
    await this._loginNow();
  }

  /**
   * Keep the SAP session mode in sync with the ICM: an anonymous context cookie
   * is never replayed (it makes the server answer `400 Session not found`), but
   * the session only degrades to stateless when SAP did not hand out a real
   * stateful session at all. Some systems return both an anonymous context and
   * `SAP_SESSIONID_*` in the same login response; degrading there would break
   * every lock-requiring command with the library's `STATELESS` error.
   */
  private applySessionMode(): void {
    if (shouldDegradeToStateless(this.client)) {
      this.client.stateful = session_types.stateless;
    } else {
      // The login produced a real SAP session cookie: keep stateful mode even
      // when the anonymous context cookie was dropped, otherwise every
      // lock-requiring operation fails with the library's STATELESS error.
      this.client.stateful = session_types.stateful;
    }
  }

  private async _loginNow(): Promise<void> {
    try {
      await this.client.login();
      this.applySessionMode();
      this.freshLogin = true;
      this.sessionReady = true;
      if (this.jar && this.sessionKey) {
        captureSessionFromAdt(this.client, this.jar);
        this.sessionReusable = await markJarPersisted(this.jar, this.config.sap, this.sessionKey);
      }
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      throw classifyHttpError(error, { name: this.config.systemName });
    }
  }

  static async create(): Promise<AdtClientWrapper> {
    try {
      const config = await loadConfig();
      const auth = buildBasicAuth(config.sap);
      const wrapper = new AdtClientWrapper(config, auth);
      await wrapper.initSession();
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
    return this.policy;
  }

  /** True when this wrapper reused a persisted SAP session (cookie jar). */
  get reusedSession(): boolean {
    return this.sessionReady && !!this.jar && this.jar.cookies.length > 0;
  }

  /**
   * True when this process opened a SAP session that the next command cannot
   * reuse (non-durable key store, unwritable jar). The end-of-command hook
   * releases such sessions so a degraded reuse path cannot leave one orphan
   * session per command.
   */
  get sessionNeedsRelease(): boolean {
    return this.freshLogin && !this.sessionReusable;
  }

  /**
   * Decide whether to reuse a persisted SAP session or fall back to a fresh
   * login on the first real request.
   *
   * cloud / btp: never touch the cookie jar — fresh login.
   *  - `always-logout`: fresh login every command; no jar read/write.
   *  - non-durable key store (test/CI backends): no jar read/write — fresh
   *    login, released again at command end.
   *  - `reuse` + valid jar: inject cookie + csrf so the first request skips
   *    the `ADTClient.login()` round-trip and reuses the SAP session.
   *  - `reuse` + no jar: lazily fresh-login on first `_call`, then capture
   *    the cookie map + csrf back into a new jar and persist it.
   *
   * Runs before any request (from `create()`), so every existing call site
   * gets session reuse without touching the 23+ `create()` callers.
   */
  private async initSession(): Promise<void> {
    this.policy = effectivePolicy(resolveSessionPolicy(this.config));
    if (isUnsupportedInContext(this.config) || this.policy === 'always-logout') {
      // Cloud/BTP or forced fresh login: no jar read/write at all.
      this.sessionReady = false;
      return;
    }

    const { key, mode } = await loadOrCreateSessionKey(this.config.sap);
    this.sessionKey = key;
    if (mode === 'ephemeral') {
      // The key store does not persist across processes, so a jar written now
      // could never be decrypted by the next command. Skip the jar entirely
      // and let the end-of-command hook release the fresh login.
      this.sessionReady = false;
      return;
    }
    const jar = await loadJarFromDisk(this.config.sap, key);
    if (jar && jar.cookies.length > 0) {
      injectSessionIntoAdt(this.client, jar);
      this.jar = jar;
      this.sessionReady = true; // first request reuses the saved SAP session
      this.sessionReusable = true;
    } else {
      this.jar =
        jar ??
        makeEmptyJar(
          { ...this.config.sap, password: '' },
          this.config.sap.systemType ?? 'on-prem',
          this.config.systemName,
        );
      this.sessionReady = false; // fresh login on first _call
    }
  }

  /** Lazy fresh login + capture/persist of the new session (first real call). */
  private async ensureSession(): Promise<void> {
    if (this.sessionReady) return;
    await this.client.login();
    this.applySessionMode();
    this.freshLogin = true;
    this.sessionReady = true;
    if (this.jar && this.sessionKey) {
      captureSessionFromAdt(this.client, this.jar);
      this.sessionReusable = await markJarPersisted(this.jar, this.config.sap, this.sessionKey);
    }
  }

  /**
   * Explicit logout — used by `always-logout` policy at command end and by
   * the SIGINT/SIGTERM handlers. Best-effort: never throws to the caller.
   *
   * The on-disk jar is cleared only when this process actually participated in
   * reuse (`this.jar` is set): those cookies are dead after the logout. Under
   * `always-logout` the wrapper never reads or writes the jar, so a jar left by
   * a concurrent `reuse` command belongs to a *different*, still-open session —
   * deleting it orphaned that session in SM04 (and forced the next command into
   * a fresh login). Mixed policies must not fight over the shared jar.
   */
  async logout(): Promise<void> {
    const ownedJar = this.jar !== null;
    try {
      await this.client.logout();
      this.sessionReady = false;
      this.freshLogin = false;
      this.sessionReusable = false;
      if (ownedJar) clearJarFromDisk(this.config.sap);
    } catch {
      // logout is best-effort — swallow transport/auth errors.
    }
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
      return await attempt();
    } catch (error: unknown) {
      const classified = error instanceof CliError ? error : classifyHttpError(error, { name: this.config.systemName });
      if (this.jar && !this.fallbackUsed && classified.code === 'AUTH_ERROR') {
        this.fallbackUsed = true;
        // Stale session: re-login, re-capture, persist, then retry the call.
        await this.client.login();
        this.applySessionMode();
        this.freshLogin = true;
        captureSessionFromAdt(this.client, this.jar);
        if (this.sessionKey) {
          this.sessionReusable = await markJarPersisted(this.jar, this.config.sap, this.sessionKey);
        }
        try {
          return await attempt();
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

  /** POST /sap/bc/adt/ddic/tabletypes — create a new TTYP object. */
  createTtyp(name: string, xml: string, packageName: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/ddic/tabletypes?_action=create&objtype=ttyp&objname=${encodeURIComponent(name.toUpperCase())}&corrNr=${encodeURIComponent(transport ?? '')}`;
      await this.client.httpClient.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/*',
          ...(packageName ? { 'X-CPACKAGE': packageName } : {}),
          ...(transport ? { 'X-CORR-NR': transport } : {}),
        },
        body: xml,
      });
    });
  }

  /** PUT /sap/bc/adt/ddic/tabletypes/<name> — overwrite an existing TTYP. */
  updateTtyp(name: string, xml: string, lockHandle: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/ddic/tabletypes/${name.toUpperCase()}`;
      await this.client.httpClient.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/*',
          ...(lockHandle ? { 'X-LOCK': lockHandle } : {}),
          ...(transport ? { 'X-CORR-NR': transport } : {}),
        },
        body: xml,
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

  /** POST /sap/bc/adt/messageclass — create a new MSAG. */
  createMsag(name: string, xml: string, packageName: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/messageclass?_action=create&objtype=msag&objname=${encodeURIComponent(name.toUpperCase())}&corrNr=${encodeURIComponent(transport ?? '')}`;
      await this.client.httpClient.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/*',
          ...(packageName ? { 'X-CPACKAGE': packageName } : {}),
          ...(transport ? { 'X-CORR-NR': transport } : {}),
        },
        body: xml,
      });
    });
  }

  /** PUT /sap/bc/adt/messageclass/<name> — overwrite an existing MSAG. */
  updateMsag(name: string, xml: string, lockHandle: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/messageclass/${name.toUpperCase()}`;
      await this.client.httpClient.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/*',
          ...(lockHandle ? { 'X-LOCK': lockHandle } : {}),
          ...(transport ? { 'X-CORR-NR': transport } : {}),
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

  /** POST /sap/bc/adt/ddic/ddl/sources — create a new DDLS. */
  createDdls(name: string, xml: string, packageName: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/ddic/ddl/sources?_action=create&objtype=ddls&objname=${encodeURIComponent(name.toLowerCase())}&corrNr=${encodeURIComponent(transport ?? '')}`;
      await this.client.httpClient.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/*',
          ...(packageName ? { 'X-CPACKAGE': packageName } : {}),
          ...(transport ? { 'X-CORR-NR': transport } : {}),
        },
        body: xml,
      });
    });
  }

  /** PUT /sap/bc/adt/ddic/ddl/sources/<name> — overwrite an existing DDLS. */
  updateDdls(name: string, xml: string, lockHandle: string, transport?: string): Promise<void> {
    return this._call(async () => {
      const url = `/sap/bc/adt/ddic/ddl/sources/${name.toLowerCase()}`;
      await this.client.httpClient.request(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/*',
          ...(lockHandle ? { 'X-LOCK': lockHandle } : {}),
          ...(transport ? { 'X-CORR-NR': transport } : {}),
        },
        body: xml,
      });
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
   * turns a remaining silent no-op into a hard failure (push path); without it
   * the flag degrades to a warning (standalone `abap activate`).
   */
  private postActivation(items: ActivationItem[], opts?: ActivationEnforcementOptions) {
    return this._call(async () => {
      const response = await this.client.httpClient.request('/sap/bc/adt/activation', {
        body: buildActivationRequest(items),
        method: 'POST',
        qs: { method: 'activate', preauditRequested: true },
      });
      const result = parseActivationResponse(String(response.body ?? ''));
      enforceActivationOutcome(result, items.map((i) => i.name).join(', '), opts);
      return result;
    });
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
   * abap-adt-api 8.4.1 does not expose a typed `serviceBinding()` method,
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
   * as JSON body — the underlying abap-adt-api 8.4.1 `runClass(name)` does
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
