import { ADTClient, session_types, type ClientOptions, type TextElement, type TextElementCategory, type DumpsFeed } from 'abap-adt-api';
import type { BearerFetcher } from 'abap-adt-api/build/AdtHTTP.js';
import { parseServiceBinding, type ServiceBinding } from 'abap-adt-api/build/api/tablecontents.js';
import { fetchDumpsFeed } from './dumps-feed.js';
import {
  getTextElements as adtGetTextElements,
  setTextElements as adtSetTextElements,
} from 'abap-adt-api/build/api/textelements.js';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';
import { buildAuth } from '../auth/adapter.js';
import { makeEmptyJar, type SessionJar } from '../session/jar.js';
import { effectivePolicy, isUnsupportedInContext, resolveSessionPolicy } from '../session/policy.js';
import { loadOrCreateSessionKey } from '../session/key.js';
import { captureSessionFromAdt, clearJarFromDisk, injectSessionIntoAdt, loadJarFromDisk, markJarPersisted } from '../session/reuse.js';
import { registerAdtClient } from '../session/registry.js';

/**
 * Thin wrapper around abap-adt-api ADTClient.
 * Initializes from project config and exposes the most common operations.
 *
 * Login strategy is selected by `config.sap.authMethod`: `basic` keeps
 * the original username/password behavior, `cert` injects an X.509
 * `https.Agent` via `buildAuth`. The chosen strategy is recorded on
 * `this.authLabel` so downstream code can surface it in doctor / probe output.
 *
 * Every method that round-trips to the ADT endpoint runs through `_call`,
 * which classifies TLS / AUTH / SAP errors via the shared HTTP classifier.
 */
export class AdtClientWrapper {
  private client: ADTClient;
  private config: ProjectConfig;
  /** Short label of the auth strategy actually used (e.g. "basic" / "cert"). */
  private authLabel: string;

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

  private constructor(config: ProjectConfig, auth: { passwordOrFetcher: string | BearerFetcher; options: ClientOptions; label: string }) {
    this.config = config;
    this.authLabel = auth.label;
    this.client = new ADTClient(
      this.config.sap.url,
      this.config.sap.username,
      auth.passwordOrFetcher,
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

  private async _loginNow(): Promise<void> {
    try {
      await this.client.login();
      this.sessionReady = true;
      if (this.jar && this.sessionKey) {
        captureSessionFromAdt(this.client, this.jar);
        await markJarPersisted(this.jar, this.config.sap, this.sessionKey);
      }
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      throw classifyHttpError(error, { name: this.config.systemName, authMethod: this.authLabel });
    }
  }

  static async create(): Promise<AdtClientWrapper> {
    try {
      const config = await loadConfig();
      const auth = await buildAuth(config.sap, config.systemName);
      const wrapper = new AdtClientWrapper(config, auth);
      await wrapper.initSession();
      registerAdtClient(wrapper);
      return wrapper;
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', message);
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
   * Decide whether to reuse a persisted SAP session or fall back to a fresh
   * login on the first real request.
   *
   *  - cloud / btp: never touch the cookie jar (FR-005) — fresh login.
   *  - `always-logout`: fresh login every command; no jar read/write.
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

    const { key } = await loadOrCreateSessionKey(this.config.sap);
    this.sessionKey = key;
    const jar = await loadJarFromDisk(this.config.sap, key);
    if (jar && jar.cookies.length > 0) {
      injectSessionIntoAdt(this.client, jar);
      this.jar = jar;
      this.sessionReady = true; // first request reuses the saved SAP session
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
    this.sessionReady = true;
    if (this.jar) {
      captureSessionFromAdt(this.client, this.jar);
      if (this.sessionKey) await markJarPersisted(this.jar, this.config.sap, this.sessionKey);
    }
  }

  /**
   * Explicit logout — used by `always-logout` policy at command end and by
   * the SIGINT/SIGTERM handlers. Best-effort: never throws to the caller.
   * After logout the SAP session is gone, so the on-disk jar for this
   * profile is cleared unconditionally (its cookies are now dead) — even in
   * `always-logout` mode where this wrapper never loaded a jar itself but a
   * stale one from a previous `reuse` run may still exist.
   */
  async logout(): Promise<void> {
    try {
      await this.client.logout();
      this.sessionReady = false;
      clearJarFromDisk(this.config.sap);
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

  /** Short label of the auth strategy actually used ("basic" / "cert"). */
  get authMethod(): string {
    return this.authLabel;
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
      const classified = error instanceof CliError ? error : classifyHttpError(error, { name: this.config.systemName, authMethod: this.authLabel });
      if (this.jar && !this.fallbackUsed && classified.code === 'AUTH_ERROR') {
        this.fallbackUsed = true;
        // Stale session: re-login, re-capture, persist, then retry the call.
        await this.client.login();
        captureSessionFromAdt(this.client, this.jar);
        if (this.sessionKey) await markJarPersisted(this.jar, this.config.sap, this.sessionKey);
        try {
          return await attempt();
        } catch (retryError: unknown) {
          if (retryError instanceof CliError) throw retryError;
          throw classifyHttpError(retryError, { name: this.config.systemName, authMethod: this.authLabel });
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

  // --- 036-ttyp-msag-ddls: dual-channel ADT endpoints (TTYP / MSAG / DDLS) ---

  /** GET /sap/bc/adt/ddic/tabletypes/<name> — retrieve a TTYP (table type).
   *  Returns the XML body verbatim; the caller (formats/ttyp/json.ts#wireToLocal)
   *  maps the wire to the local AFF nested shape. */
  getTtyp(name: string): Promise<string> {
    return this._call(async () => {
      const url = `/sap/bc/adt/ddic/tabletypes/${name.toUpperCase()}`;
      // 036: DDIC atom endpoints reject narrow Accept types (406); fall back
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

  activate(objectUrl: string, objectType: string, objectName: string, _mainInclude?: string) {
    // Always use the array overload. The string overload appends ?context=main
    // which real SAP rejects for both programs and classes here with
    // "User X is currently editing Y".
    return this._call(() =>
      this.client.activate([
        {
          'adtcore:uri': objectUrl,
          'adtcore:type': objectType,
          'adtcore:name': objectName,
          'adtcore:parentUri': objectUrl,
        },
      ]),
    );
  }

  /**
   * Activate a full list of inactive items (method/OSI source level). The
   * root-URI-only activate can silently no-op on real SAP (013 dogfooding).
   */
  activateAll(items: Array<{ uri: string; type: string; name: string; parentUri: string }>) {
    return this._call(() =>
      this.client.activate(
        items.map((i) => ({
          'adtcore:uri': i.uri,
          'adtcore:type': i.type,
          'adtcore:name': i.name,
          'adtcore:parentUri': i.parentUri,
        })),
      ),
    );
  }

  /** List inactive objects (edit sessions awaiting activation). */
  inactiveObjects() {
    return this._call(() => this.client.inactiveObjects());
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
   * T3.2 — Fetch the nested service-binding metadata omitted by
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
   * T3.1 — Fetch the source DDL for a service definition (SRVD).
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
   * 015-abap-run: optional second `params` argument forwards classrun input
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

  // --- Text elements (textpool; 014 US4) ---

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

  // --- Object creation ---

  /**
   * Create a CLAS / INTF / PROG / FUGR using the wrapper at
   * `./create-object.ts` which sets `Content-Type: application/xml` (BTP / Steampunk
   * safe) instead of the library's `application/*`. Falls back to the upstream
   * library for unsupported types.
   *
   * Set `ABAP_CLI_LEGACY_CREATE=1` to skip the wrapper and use the library
   * directly (the legacy `application/*` Content-Type).
   */
  createObject(options: Parameters<ADTClient['createObject']>[0]) {
    return this._call(async () => {
      if (process.env.ABAP_CLI_LEGACY_CREATE === '1') {
        return this.client.createObject(options);
      }
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
