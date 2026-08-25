/**
 * Side-effect aggregator for auth strategies.
 *
 * Any module that needs to resolve strategies (e.g. `http-error.ts`, which
 * looks up error hints at classification time) imports this file once instead
 * of listing every strategy — so adding a new method only requires adding
 * ONE import line here.
 *
 * Idempotent: each strategy's `registerStrategy` overwrites any previous
 * registration with the same `method`, so importing this module twice (e.g.
 * from `adapter.ts` AND `http-error.ts`) is safe.
 */
import './strategies/basic.js';
import './strategies/cert.js';
import './strategies/browser-sso.js';
import './strategies/oauth-password.js';