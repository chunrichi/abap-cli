import keytar from 'keytar';

const SERVICE = 'abap-cli';

/**
 * Store a password in the OS keychain (macOS Keychain / Windows Credential Store / Linux Secret Service).
 * The password is encrypted by the OS and never written to disk.
 *
 * @param account The system profile name (keychain entry per system, not per workspace)
 * @param password The password to store
 */
export async function storePassword(account: string, password: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, password);
}

/**
 * Retrieve a password from the OS keychain.
 *
 * @param account The system profile name
 * @returns The password, or null if not found
 */
export async function getPassword(account: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, account);
}

/**
 * Delete a password from the OS keychain.
 *
 * @param account The system profile name
 * @returns true if deleted, false if not found
 */
export async function deletePassword(account: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE, account);
}
