import { ADTClient, createSSLConfig, session_types, type TextElement, type TextElementCategory } from 'abap-adt-api';
import {
  getTextElements as adtGetTextElements,
  setTextElements as adtSetTextElements,
} from 'abap-adt-api/build/api/textelements.js';
import { loadConfig, readCaCertificate, type ProjectConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';
import { classifyHttpError } from './http-error.js';

/**
 * Thin wrapper around abap-adt-api ADTClient.
 * Initializes from project config and exposes the most common operations.
 *
 * Every method that round-trips to the ADT endpoint runs through `_call`,
 * which classifies TLS / AUTH / SAP errors via the shared HTTP classifier.
 */
export class AdtClientWrapper {
  private client: ADTClient;
  private config: ProjectConfig;

  private constructor(config: ProjectConfig) {
    this.config = config;
    this.client = new ADTClient(
      this.config.sap.url,
      this.config.sap.username,
      this.config.sap.password,
      this.config.sap.client,
      this.config.sap.language,
      createSSLConfig(this.config.sap.insecure, readCaCertificate(this.config.sap.caPath)),
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
      return new AdtClientWrapper(config);
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
      throw classifyHttpError(error, { name: this.config.sap.username });
    }
  }

  // --- Object operations ---

  searchObject(query: string, objType?: string, maxResults = 100) {
    return this._call(() => this.client.searchObject(query, objType, maxResults));
  }

  getObjectSource(objectSourceUrl: string) {
    return this._call(() => this.client.getObjectSource(objectSourceUrl));
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

  /** Structure elements for `inspect --structure` (FR-012). */
  objectStructureElements(objectUrl: string, version?: Parameters<ADTClient['objectStructureElements']>[1]) {
    return this._call(() => this.client.objectStructureElements(objectUrl, version));
  }

  /** Run an ABAP class as an application (ADT classrun, e.g. ICF setup). */
  runClass(className: string) {
    return this._call(() => this.client.runClass(className));
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

  /** Structured transport metadata for `transport show <req>` (FR-015). */
  transportDetails(transportNumber: string) {
    return this._call(() => this.client.transportDetails(transportNumber));
  }

  // --- Object creation ---

  createObject(options: Parameters<ADTClient['createObject']>[0]) {
    return this._call(() => this.client.createObject(options));
  }

  /** Validate a proposed object without creating it (FR-021, `create --check-only`). */
  validateNewObject(options: Parameters<ADTClient['validateNewObject']>[0]) {
    return this._call(() => this.client.validateNewObject(options));
  }

  // --- Deletion ---

  deleteObject(objectUrl: string, lockHandle: string, transport?: string) {
    return this._call(() => this.client.deleteObject(objectUrl, lockHandle, transport));
  }

  // --- ATC (check --atc, FR-011) ---

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
}
