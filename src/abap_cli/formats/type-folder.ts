/**
 * Local-convention type → subdirectory mapping.
 *
 * Migrated to `types/registry.ts` (T046, US11). This module now re-exports
 * the single source of truth; the legacy `TYPE_FOLDER` constant is gone.
 */
export { folderFor } from '../types/registry.js';