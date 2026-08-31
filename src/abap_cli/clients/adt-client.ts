import { ADTClient, session_types, type ClientOptions, type TextElement, type TextElementCategory, type DumpsFeed } from 'abap-adt-api';
import type { BearerFetcher } from 'abap-adt-api/build/AdtHTTP.js';
import { dumps as adtDumps } from 'abap-adt-api/build/api/feeds.js';
import {
  getTextElements as adtGetTextElements,
  setTextElements as adtSetTextElements,
} from 'abap-adt-api/build/api/textelements.js';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';
import { buildAuth } from '../auth/adapter.js';

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
   * Log in to the SAP system (sets basic-auth credentials + acquires the
   * initial CSRF token via a fetch probe). Without this the first ADT request
   * returns 401 because the auth context has not been negotiated.
   */
  async login(): Promise<void> {
    await this._call(() => this.client.login());
  }

  static async create(): Promise<AdtClientWrapper> {
    try {
      const config = await loadConfig();
      const auth = await buildAuth(config.sap, config.systemName);
      return new AdtClientWrapper(config, auth);
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError('CONFIG_ERROR', message);
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
   */
  private async _call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error: unknown) {
      if (error instanceof CliError) throw error;
      throw classifyHttpError(error, { name: this.config.systemName, authMethod: this.authLabel });
    }
  }

  // --- Object operations ---

  searchObject(query: string, objType?: string, maxResults = 100) {
    return this._call(() => this.client.searchObject(query, objType, maxResults));
  }

  getObjectSource(objectSourceUrl: string) {
    return this._call(() => this.client.getObjectSource(objectSourceUrl));
  }

  /** Where-used: direct references to an object (ADT usageReferences). */
  usageReferences(objectUrl: string, line?: number, column?: number) {
    return this._call(() => this.client.usageReferences(objectUrl, line, column));
  }

  setObjectSource(objectSourceUrl: string, source: string, lockHandle: string, transport?: string) {
    return this._call(() => this.client.setObjectSource(objectSourceUrl, source, lockHandle, transport));
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

  /** Validate a proposed object without creating it (FR-021, `create --check-only`). */
  validateNewObject(options: Parameters<ADTClient['validateNewObject']>[0]) {
    return this._call(() => this.client.validateNewObject(options));
  }

  // --- Deletion ---

  deleteObject(objectUrl: string, lockHandle: string, transport?: string) {
    return this._call(() => this.client.deleteObject(objectUrl, lockHandle, transport));
  }

  // --- ATC (check atc, FR-011) ---

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
   * `/sap/bc/adt/runtime/dumps`. Read-only — never creates locks, transports, or
   * SAP data. The `$top` query is sent to SAP so the server trims the result set
   * before it reaches the CLI; `--user` adds an OData `$filter` when given.
   *
   * Bypasses `this.client.dumps(query?)` because the library wraps the query in
   * `$query=<value>`, while SAP ADT expects OData `$top` / `$filter`. Calling
   * the internal `dumps(h, query)` parser keeps us aligned with `DumpsFeed`
   * type while we own the wire request.
   */
  dumps(limit?: number, user?: string): Promise<DumpsFeed> {
    return this._call(() => {
      const parts: string[] = [];
      if (typeof limit === 'number') parts.push(`$top=${limit}`);
      if (user) parts.push(`$filter=author eq '${user.replace(/'/g, "''")}'`);
      return adtDumps(this.client.httpClient, parts.join(';'));
    });
  }
}
