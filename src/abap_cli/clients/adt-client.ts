import { ADTClient, session_types } from 'abap-adt-api';
import { loadConfig, type ProjectConfig } from '../config/project-config.js';

/**
 * Thin wrapper around abap-adt-api ADTClient.
 * Initializes from project config and exposes the most common operations.
 */
export class AdtClientWrapper {
  private client: ADTClient;
  private config: ProjectConfig;

  constructor() {
    this.config = loadConfig();
    this.client = new ADTClient(
      this.config.sap.url,
      this.config.sap.username,
      this.config.sap.password,
      this.config.sap.client,
      this.config.sap.language,
    );
    this.client.stateful = session_types.stateful;
  }

  get raw(): ADTClient {
    return this.client;
  }

  getConfig(): ProjectConfig {
    return this.config;
  }

  // --- Object operations ---

  async searchObject(query: string, maxResults = 100) {
    return this.client.searchObject(query, undefined, maxResults);
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

  async activate(objectUrl: string) {
    // activate expects InactiveObject[], wrap the URL
    return this.client.activate([{ objectUrl } as any]);
  }

  // --- Syntax check ---

  async syntaxCheck(cdsUrl: string) {
    return this.client.syntaxCheck(cdsUrl);
  }

  // --- Object structure ---

  async objectStructure(objectUrl: string) {
    return this.client.objectStructure(objectUrl);
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
