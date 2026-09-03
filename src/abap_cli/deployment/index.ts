/**
 * Deployment context — namespace reserved for the future migration of
 * transport/package metadata into a higher-level "deployment" abstraction.
 *
 * Currently a placeholder: the CLI handles transports through the existing
 * `transportRequest` field embedded in object payloads (spec 014 + spec 029).
 * A future spec will hoist transport + package + software component concerns
 * into a unified context; this directory is reserved so callers can begin
 * importing `src/abap_cli/deployment` (the path) without churn later.
 *
 * No executable code lives here — the file exports nothing so importing it
 * has zero side effects.
 */

// reserved for future transport/package → deployment context migration; no implementation
export const DEPLOYMENT_NAMESPACE_VERSION = '0.0.0-reserved';
