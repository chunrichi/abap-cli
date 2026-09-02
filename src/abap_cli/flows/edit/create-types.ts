/**
 * Create-time type registry adapter.
 *
 * Migrated to `types/registry.ts` (T047, US11). The legacy `TYPE_MAP`
 * constant is gone; consumers now call `createObjtypeFor(type)` directly.
 *
 * Re-exports keep the existing call sites compiling; new code should
 * import the registry helpers directly.
 */
export {
  createObjtypeFor,
  isDdicSupportedType,
  isHttpSupportedType,
  isTranSupportedType,
  DDIC_TYPES,
  HTTP_TYPES,
  TRAN_TYPES,
  DDIC_SUPPORTED_TYPES,
  HTTP_SUPPORTED_TYPES,
  TRAN_SUPPORTED_TYPES,
} from '../../types/registry.js';
