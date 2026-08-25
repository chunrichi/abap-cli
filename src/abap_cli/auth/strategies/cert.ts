/**
 * `cert` auth strategy — X.509 client certificate over mTLS.
 *
 * Loads the cert + key from disk and wraps them in a Node `https.Agent` that
 * axios (under `abap-adt-api`) will use for every ADT request. SAP accepts a
 * sentinel password string for cert auth; we use the SAP-conventional
 * `"x509-cert-auth"` placeholder.
 *
 * Path validation is strict: a missing cert/key or unreachable passphrase
 * throws `CONFIG_ERROR` rather than silently falling back to basic auth,
 * which would leak the user's stored password to a server they meant to
 * authenticate to with a certificate.
 */
import * as fs from 'fs';
import https from 'https';
import { createSSLConfig } from 'abap-adt-api';
import { readCaCertificate } from '../../config/project-config.js';
import type { SapConfig } from '../../config/project-config.js';
import { getCertPassphrase } from '../../config/secrets.js';
import { CliError } from '../../output/json.js';
import type { AuthStrategy } from '../strategy.js';
import { registerStrategy } from '../strategy.js';

async function buildCertAgent(sap: SapConfig, systemName: string, cfg: { certPath: string; keyPath: string; caPath?: string }): Promise<https.Agent> {
  if (!cfg.certPath || !cfg.keyPath) {
    throw new CliError('CONFIG_ERROR',
      `Profile '${systemName}' has incomplete cert auth (need certPath AND keyPath).`,
      { example: `abap profile set ${systemName} --auth-method cert --cert-path <cert> --cert-key <key>` });
  }
  if (!fs.existsSync(cfg.certPath)) {
    throw new CliError('CONFIG_ERROR', `X.509 certificate not found at '${cfg.certPath}'.`, {
      nextSteps: [`Re-run: abap profile set ${systemName} --auth-method cert --cert-path <correct-path>`],
      example: `abap profile set ${systemName} --auth-method cert --cert-path /abs/cert.pem --cert-key /abs/key.pem`,
    });
  }
  if (!fs.existsSync(cfg.keyPath)) {
    throw new CliError('CONFIG_ERROR', `X.509 private key not found at '${cfg.keyPath}'.`, {
      nextSteps: [`Re-run: abap profile set ${systemName} --auth-method cert --cert-key <correct-path>`],
    });
  }
  const passphrase = await getCertPassphrase(systemName);

  // Cert-level CA overrides the profile-level `ca` for the mTLS handshake.
  // Falls back to the global CA so a cert-only profile still trusts the server
  // (cert auth still requires server-cert verification unless `--insecure`).
  const ca = (cfg.caPath ? readCaCertificate(cfg.caPath) : undefined) ?? readCaCertificate(sap.caPath);

  return new https.Agent({
    cert: fs.readFileSync(cfg.certPath),
    key: fs.readFileSync(cfg.keyPath),
    passphrase: passphrase ?? '',
    ca,
    rejectUnauthorized: !sap.insecure && Boolean(ca),
  });
}

registerStrategy({
  method: 'cert',
  async build(sap: SapConfig, systemName: string, auth) {
    if (auth.method !== 'cert') throw new Error('Strategy mismatch');
    const ssl = createSSLConfig(sap.insecure, readCaCertificate(sap.caPath));
    return {
      passwordOrFetcher: 'x509-cert-auth',
      options: { ...ssl, httpsAgent: await buildCertAgent(sap, systemName, auth.cert) },
    };
  },
  hints: {
    nextSteps: [
      "Confirm the cert subject is mapped to a SAP user via CERTRULE / STRUST.",
      "Re-run: 'abap profile test <name> --json' to see the TLS layer detail.",
      "If the passphrase changed: 'abap profile set <name> --cert-passphrase <new>'.",
    ],
    example: 'abap profile set <name> --cert-passphrase <new>',
  },
  fromOptions(opts, base) {
    const existingCert = base.method === 'cert' ? base.cert : undefined;
    const certPath = opts.bag.certPath ?? existingCert?.certPath;
    const keyPath = opts.bag.keyPath ?? existingCert?.keyPath;
    const caPath = opts.bag.caPath ?? existingCert?.caPath;
    if (!certPath || !keyPath) {
      throw new CliError('INVALID_ARGUMENT',
        'cert auth requires both certPath and keyPath. ' +
        'Provide them via --auth-option certPath=/abs/cert.pem --auth-option keyPath=/abs/key.pem.',
        { example: 'abap profile add <name> --auth-method cert --auth-option certPath=/abs/cert.pem --auth-option keyPath=/abs/key.pem' });
    }
    const block = { certPath, keyPath, ...(caPath ? { caPath } : {}) };
    return { method: 'cert', cert: block };
  },
});
