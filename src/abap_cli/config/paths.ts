/**
 * Centralized filesystem paths for the user-level config / state directories.
 *
 *   1. The constants live in one place (no scattered `path.join(os.homedir(),
 *      '.abap-cli', 'systems.json')` calls).
 *   2. `home` is injectable so unit tests can point at a temp directory
 *      instead of the real `~`.
 *
 * Scope: this module is the **single source of truth** for the user-level
 * config directory + systems.json path. `config/project-config.ts` reads it;
 * other modules (`config/user-config.ts`, `session/reuse.ts`,
 * `auth/sso-cookie.ts`) still call `os.homedir()` directly — they don't
 * need an injection seam right now. When a test needs to redirect them too,
 * extend `paths.ts` and thread `home` through.
 */
import * as os from 'node:os';
import * as path from 'node:path';

/** User-level config directory name (sibling of `~`). */
export const USER_CONFIG_DIR_NAME = '.abap-cli';

/** User-level system profiles file name. */
export const USER_CONFIG_FILE_NAME = 'systems.json';

/**
 * User-level config directory.
 * @param home — defaults to `os.homedir()`; tests inject a temp dir.
 */
export function userConfigDir(home: string = os.homedir()): string {
  return path.join(home, USER_CONFIG_DIR_NAME);
}

/**
 * Full path to the user-level `systems.json`.
 * @param home — defaults to `os.homedir()`; tests inject a temp dir.
 */
export function userConfigPath(home: string = os.homedir()): string {
  return path.join(userConfigDir(home), USER_CONFIG_FILE_NAME);
}
