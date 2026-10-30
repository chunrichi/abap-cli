/**
 * Login artefacts for SAP basic auth (username + password over HTTP Basic).
 *
 * The password is resolved from the OS keychain by `project-config` and
 * carried on `SapConfig.password`; TLS trust (`--insecure` / `--ca`) is turned
 * into `ClientOptions` here so ADT, ICF, probe and runtime-probe all log in
 * with the same transport settings.
 */
import { createSSLConfig, type ClientOptions } from 'abap-adt-api';
import type { SapConfig } from '../config/project-config.js';
import { readCaCertificate } from '../config/project-config.js';

export interface BuiltAuth {
  /** Password literal passed to `new ADTClient(url, user, password, …)`. */
  password: string;
  /** TLS options (custom CA / insecure) merged into `ADTClient` and axios. */
  options: ClientOptions;
}

export function buildBasicAuth(sap: SapConfig): BuiltAuth {
  return {
    password: sap.password,
    options: createSSLConfig(sap.insecure, readCaCertificate(sap.caPath)),
  };
}
