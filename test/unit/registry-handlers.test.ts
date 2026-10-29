/**
 * Phase 3: handler registration API on `types/registry.ts`.
 *
 * create / pull / push dispatchers consult per-type handler tables populated
 * at module load. Tests cover the registration surface (register / lookup /
 * duplicate / clear) without exercising the production side-effect imports —
 * that wiring is covered by the dispatcher-level tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearHandlersForTesting,
  restoreHandlersForTesting,
  createHandlerFor,
  pullHandlerFor,
  registerCreateHandler,
  registerPullHandler,
  type CreateHandler,
  type PullHandler,
} from '../../src/abap_cli/types/registry.js';

// Isolate the mutable handler tables: clear before each case, then reinstate
// the module-load registrations afterwards so a later dispatcher-level test in
// this file (or another test in the same module graph) still sees them.
beforeEach(() => {
  clearHandlersForTesting();
});
afterEach(() => {
  restoreHandlersForTesting();
});

const noopCreate: CreateHandler = async () => {};
const noopPull: PullHandler = async () => ({ object: 'X', files: [], channel: 'adt' });

describe('create handler registry', () => {
  it('registers and looks up by uppercase type', () => {
    registerCreateHandler('clas', noopCreate);
    expect(createHandlerFor('clas')).toBe(noopCreate);
    expect(createHandlerFor('CLAS')).toBe(noopCreate);
    expect(createHandlerFor('Clas')).toBe(noopCreate);
  });

  it('returns undefined for an unregistered type', () => {
    expect(createHandlerFor('NOT_A_TYPE')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    registerCreateHandler('TTYP', noopCreate);
    expect(() => registerCreateHandler('TTYP', noopCreate)).toThrowError(/already registered/);
  });

  it('clearHandlersForTesting wipes both tables', () => {
    registerCreateHandler('TTYP', noopCreate);
    registerPullHandler('TTYP', noopPull);
    clearHandlersForTesting();
    expect(createHandlerFor('TTYP')).toBeUndefined();
    expect(pullHandlerFor('TTYP')).toBeUndefined();
  });
});

describe('pull handler registry', () => {
  it('registers and looks up by uppercase type', () => {
    registerPullHandler('msag', noopPull);
    expect(pullHandlerFor('msag')).toBe(noopPull);
    expect(pullHandlerFor('MSAG')).toBe(noopPull);
  });

  it('returns undefined for an unregistered type', () => {
    expect(pullHandlerFor('UNKNOWN')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    registerPullHandler('DDLS', noopPull);
    expect(() => registerPullHandler('DDLS', noopPull)).toThrowError(/already registered/);
  });
});

/**
 * Regression: clearHandlersForTesting used to snapshot the registry at module
 * load — before any per-type module had registered — so restoreHandlersForTesting
 * silently left the tables empty and a downstream dispatcher test would fall
 * through to the source-object path. The snapshot must be captured on each
 * clear (post-import).
 */
describe('handler restore across clears', () => {
  it('restoreHandlersForTesting reinstates the handlers present before the clear', () => {
    registerCreateHandler('CLAS', noopCreate);
    clearHandlersForTesting();
    expect(createHandlerFor('CLAS')).toBeUndefined();
    restoreHandlersForTesting();
    expect(createHandlerFor('CLAS')).toBe(noopCreate);
  });

  it('a second clear re-captures the post-restore state, not the pre-test one', () => {
    registerCreateHandler('CLAS', noopCreate);
    clearHandlersForTesting();
    restoreHandlersForTesting();
    expect(createHandlerFor('CLAS')).toBe(noopCreate);
    // Clear again — should snapshot the current (restored) state, then
    // restore back to that same state.
    clearHandlersForTesting();
    expect(createHandlerFor('CLAS')).toBeUndefined();
    restoreHandlersForTesting();
    expect(createHandlerFor('CLAS')).toBe(noopCreate);
  });
});
