import { ADTClient, session_types } from 'abap-adt-api';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';
import { CliError } from '../output/json.js';

/**
 * Thin wrapper around abap-adt-api ADTClient.
 * Initializes from project config and exposes the most common operations.
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
    );
    this.client.stateful = session_types.stateful;
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

  // --- Object operations ---

  async searchObject(query: string, objType?: string, maxResults = 100) {
    return this.client.searchObject(query, objType, maxResults);
  }

  async getObjectSource(objectSourceUrl: string) {
    return this.client.getObjectSource(objectSourceUrl);
  }

  async setObjectSource(objectSourceUrl: string, source: string, lockHandle: string, transport?: string) {
    return this.client.setObjectSource(objectSourceUrl, source, lockHandle, transport);
  }

  // --- Lock operations ---

  async lock(objectUrl: string) {
    return this.client.lock(objectUrl);
  }

  async unLock(objectUrl: string, lockHandle: string) {
    return this.client.unLock(objectUrl, lockHandle);
  }

  // --- Activation ---

  async activate(objectUrl: string, objectType: string, objectName: string, _mainInclude?: string) {
    // Always use the array overload. The string overload appends ?context=main
    // which real SAP rejects for both programs and classes here with
    // "User X is currently editing Y".
    return this.client.activate([{
      'adtcore:uri': objectUrl,
      'adtcore:type': objectType,
      'adtcore:name': objectName,
      'adtcore:parentUri': objectUrl,
    }]);
  }

  // --- Syntax check ---

  async syntaxCheck(cdsUrl: string) {
    return this.client.syntaxCheck(cdsUrl);
  }

  /** Content-based syntax check: validates local content without saving it. */
  async syntaxCheckContent(url: string, mainUrl: string, content: string, mainProgram?: string) {
    return this.client.syntaxCheck(url, mainUrl, content, mainProgram);
  }

  // --- Object structure ---

  async objectStructure(objectUrl: string) {
    return this.client.objectStructure(objectUrl);
  }

  /** Main program(s) for an include part (program/function-group includes). */
  async mainPrograms(includeUrl: string) {
    return this.client.mainPrograms(includeUrl);
  }

  // --- Transport ---

  async transportInfo(objSourceUrl: string, devClass?: string) {
    return this.client.transportInfo(objSourceUrl, devClass);
  }

  async createTransport(objSourceUrl: string, requestText: string, devClass: string) {
    return this.client.createTransport(objSourceUrl, requestText, devClass);
  }

  async userTransports(user: string, targets?: boolean) {
    return this.client.userTransports(user, targets);
  }

  // --- Object creation ---

  async createObject(options: Parameters<ADTClient['createObject']>[0]) {
    return this.client.createObject(options);
  }

  // --- Deletion ---

  async deleteObject(objectUrl: string, lockHandle: string, transport?: string) {
    return this.client.deleteObject(objectUrl, lockHandle, transport);
  }

  // --- ATC ---

  // TODO: ATC methods - check abap-adt-api for correct method names
  // async createAtcRun(variant: string, mainUrl: string, maxResults = 100) {}
  // async atcWorklists(runResultId: string) {}
}
