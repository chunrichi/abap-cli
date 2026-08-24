import keytar from 'keytar';
import { CliError } from '../output/json.js';

const SERVICE = 'abap-cli';

/** Account suffix for X.509 cert passphrase (kept off the main keychain entry). */
const CERT_PASSPHRASE_SUFFIX = '.cert-passphrase';

function keychainError(op: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new CliError('CONFIG_ERROR', `Cannot ${op} password in OS keychain: ${message}`);
}

/**
 * Store a password in the OS keychain (macOS Keychain / Windows Credential Store / Linux Secret Service).
 * The password is encrypted by the OS and never written to disk.
 *
 * @param account The system profile name (keychain entry per system, not per workspace)
 * @param password The password to store
 */
export async function storePassword(account: string, password: string): Promise<void> {
  try {
    await keytar.setPassword(SERVICE, account, password);
  } catch (error: unknown) {
    keychainError('store', error);
  }
}

/**
 * Retrieve a password from the OS keychain.
 *
 * @param account The system profile name
 * @returns The password, or null if not found
 */
export async function getPassword(account: string): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, account);
  } catch (error: unknown) {
    keychainError('read', error);
  }
}

/**
 * Delete a password from the OS keychain.
 *
 * @param account The system profile name
 * @returns true if deleted, false if not found
 */
export async function deletePassword(account: string): Promise<boolean> {
  try {
    return await keytar.deletePassword(SERVICE, account);
  } catch (error: unknown) {
    keychainError('delete', error);
  }
}

/**
 * Store an X.509 client-cert passphrase in the OS keychain under a separate
 * account (`<profile>.cert-passphrase`) so it cannot collide with the main login
 * password and so `profile delete` can clear both with one OS-keychain sweep.
 */
export async function storeCertPassphrase(account: string, passphrase: string): Promise<void> {
  try {
    await keytar.setPassword(SERVICE, `${account}${CERT_PASSPHRASE_SUFFIX}`, passphrase);
  } catch (error: unknown) {
    keychainError('store cert passphrase', error);
  }
}

/** Returns the X.509 cert passphrase, or null when none is stored / required. */
export async function getCertPassphrase(account: string): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, `${account}${CERT_PASSPHRASE_SUFFIX}`);
  } catch (error: unknown) {
    keychainError('read cert passphrase', error);
  }
}

/** Delete the X.509 cert passphrase from the OS keychain. Never throws when missing. */
export async function deleteCertPassphrase(account: string): Promise<boolean> {
  try {
    return await keytar.deletePassword(SERVICE, `${account}${CERT_PASSPHRASE_SUFFIX}`);
  } catch (error: unknown) {
    keychainError('delete cert passphrase', error);
  }
}
