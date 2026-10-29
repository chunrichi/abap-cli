/**
 * `basic` auth strategy — username + password, sent via HTTP Basic on every
 * ADT request. Password is sourced from `sap.password` (which the project
 * config layer resolves from keychain → env → interactive prompt in that
 * priority).
 */
import type { SapConfig } from '../../config/project-config.js';
import { readCaCertificate } from '../../config/project-config.js';
import { createSSLConfig } from 'abap-adt-api';
import type { AuthStrategy } from '../strategy.js';
import { registerStrategy } from '../strategy.js';

registerStrategy({
  method: 'basic',
  async build(sap: SapConfig) {
    return {
      passwordOrFetcher: sap.password,
      options: createSSLConfig(sap.insecure, readCaCertificate(sap.caPath)),
    };
  },
  // hints omitted — `getAuthHints()` falls back to BASIC_HINTS.
  fromOptions(_opts, _base) {
    // basic takes no extra config; ignore the bag entirely.
    return { method: 'basic' };
  },
});
