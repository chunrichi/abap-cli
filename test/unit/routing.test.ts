/**
 * Explicit routing table (`flows/edit/routing.ts`).
 *
 * The table replaced the former module-load handler registration
 * (`registerCreateHandler` / `registerPullHandler` + snapshot API) and the
 * dispatcher if-chains. These tests pin the contract: one row per supported
 * type, every operation routed, and the channel declared per operation matches
 * what the flows actually do.
 */
import { describe, expect, it } from 'vitest';
import { TYPE_REGISTRY, allSupportedTypes } from '../../src/abap_cli/types/registry.js';
import { TYPE_ROUTES, typeRouteFor, type RouteChannel } from '../../src/abap_cli/flows/edit/routing.js';

/** 'auto' = channel detection picks ADT or ICF per SAP release. */
type ExpectedChannel = RouteChannel | undefined;

interface ExpectedRoute {
  create: ExpectedChannel;
  pull: ExpectedChannel;
  push: ExpectedChannel;
}

/**
 * Per-type channel contract. `undefined` means the operation is not supported
 * for that type (SRVB is pull-only metadata; BDEF is pull-only too — no ADT
 * create endpoint).
 */
const EXPECTED: Record<string, ExpectedRoute> = {
  CLAS: { create: 'adt', pull: 'adt', push: 'adt' },
  INTF: { create: 'adt', pull: 'adt', push: 'adt' },
  PROG: { create: 'adt', pull: 'adt', push: 'adt' },
  FUGR: { create: 'adt', pull: 'adt', push: 'adt' },
  DEVC: { create: 'adt', pull: 'adt', push: undefined },
  TABL: { create: 'icf', pull: 'icf', push: 'icf' },
  STRU: { create: 'icf', pull: 'icf', push: 'icf' },
  DOMA: { create: 'icf', pull: 'icf', push: 'icf' },
  DTEL: { create: 'icf', pull: 'icf', push: 'icf' },
  ENQU: { create: 'icf', pull: 'icf', push: 'icf' },
  VIEW: { create: 'icf', pull: 'icf', push: 'icf' },
  NROB: { create: 'icf', pull: 'auto', push: 'icf' },
  HTTP: { create: 'icf', pull: 'icf', push: 'icf' },
  TRAN: { create: 'icf', pull: 'icf', push: 'icf' },
  TTYP: { create: 'auto', pull: 'auto', push: 'auto' },
  MSAG: { create: 'auto', pull: 'auto', push: 'auto' },
  DDLS: { create: 'auto', pull: 'auto', push: 'auto' },
  SRVD: { create: 'adt', pull: 'adt', push: 'adt' },
  BDEF: { create: undefined, pull: 'adt', push: 'adt' },
  DCLS: { create: 'adt', pull: 'adt', push: 'adt' },
  DDLX: { create: 'adt', pull: 'adt', push: 'adt' },
  DDLA: { create: 'adt', pull: 'adt', push: 'adt' },
  SRVB: { create: undefined, pull: 'adt', push: undefined },
};

const OPS = ['create', 'pull', 'push'] as const;

describe('routing table — coverage', () => {
  it('has exactly one row per supported registry type', () => {
    expect(Object.keys(TYPE_ROUTES).sort()).toEqual([...allSupportedTypes()].sort());
    // The expectation map is the guard against a silently added/renamed type.
    expect(Object.keys(EXPECTED).sort()).toEqual([...allSupportedTypes()].sort());
  });

  it('declares the expected channel for every operation (and omits unsupported ones)', () => {
    for (const type of allSupportedTypes()) {
      const expected = EXPECTED[type]!;
      const row = TYPE_ROUTES[type]!;
      for (const op of OPS) {
        const route = row[op];
        if (expected[op] === undefined) {
          expect(route, `${type}.${op} must not be routed`).toBeUndefined();
        } else {
          expect(route, `${type}.${op} must be routed`).toBeDefined();
          expect(route!.channel, `${type}.${op} channel`).toBe(expected[op]);
        }
      }
    }
  });

  it('handler routes carry callable run functions; source routes do not', () => {
    for (const [type, row] of Object.entries(TYPE_ROUTES)) {
      for (const op of ['create', 'pull'] as const) {
        const route = row[op];
        if (route?.kind === 'handler') {
          expect(typeof route.run, `${type}.${op}.run`).toBe('function');
        }
      }
      const push = row.push;
      if (!push) continue;
      if (push.kind === 'source') {
        expect(['adt', 'icf']).toContain(push.channel);
        expect('run' in push).toBe(false);
      } else {
        expect(typeof push.run, `${type}.push.run`).toBe('function');
        expect(typeof push.validate, `${type}.push.validate`).toBe('function');
      }
    }
  });
});

describe('routing table — registry alignment', () => {
  it('ICF-routed registry types only declare ICF routes', () => {
    for (const entry of TYPE_REGISTRY) {
      if (entry.source !== 'ICF') continue;
      const row = TYPE_ROUTES[entry.type]!;
      for (const op of OPS) {
        const route = row[op];
        if (route) expect(route.channel, `${entry.type}.${op}`).toBe('icf');
      }
    }
  });

  it('ADT-routed types are never hard-wired to ICF for pull', () => {
    for (const entry of TYPE_REGISTRY) {
      if (entry.source !== 'ADT') continue;
      const pull = TYPE_ROUTES[entry.type]!.pull;
      expect(pull?.channel, `${entry.type}.pull`).not.toBe('icf');
    }
  });
});

describe('routing table — lookup helpers', () => {
  it('resolves rows case-insensitively', () => {
    expect(typeRouteFor('clas')).toBe(TYPE_ROUTES.CLAS);
    expect(typeRouteFor('Clas')).toBe(TYPE_ROUTES.CLAS);
    expect(typeRouteFor('TABL')).toBe(TYPE_ROUTES.TABL);
  });

  it('returns undefined for unknown / missing types', () => {
    expect(typeRouteFor(undefined)).toBeUndefined();
    expect(typeRouteFor('NOPE')).toBeUndefined();
  });
});
