/**
 * Schema-compliance test helpers shared by every per-type suite.
 *
 * The schemas are read from the local AFF mirror (read-only). Callers
 * supply a relative path under `test/fixtures/` and assert.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { expect } from 'vitest';
import { validateAff, formatLine } from '../../../src/abap_cli/aff/schema-validator.js';
import { schemaPathFor } from '../../../src/abap_cli/aff/schema-paths.js';

export const FIXTURES_ROOT = path.join(process.cwd(), 'test', 'fixtures');

/** Resolve `test/fixtures/<file>` to an absolute path. */
export function fx(rel: string): string {
  return path.join(FIXTURES_ROOT, rel);
}

/** Read & parse a fixture JSON; throws a clean assertion error on failure. */
export async function readJsonFixture(rel: string): Promise<unknown> {
  const raw = await fs.readFile(fx(rel), 'utf8');
  return JSON.parse(raw);
}

/** Assert a fixture matches its inferred schema exactly. */
export async function expectSchemaPass(rel: string, type?: string): Promise<void> {
  const doc = await readJsonFixture(rel);
  const inferred = type ?? inferTypeFromName(rel);
  const r = await validateAff(inferred, doc);
  if (r.status !== 'pass') {
    throw new Error(
      `expected PASS for ${rel}, got ${r.status}: ${r.errors
        .slice(0, 3)
        .map((e) => `${e.instancePath || '/'} ${e.keyword}: ${e.message}`)
        .join(' | ')}`,
    );
  }
  expect(r.status).toBe('pass');
}

/** Assert an in-memory document fails schema validation. */
export async function expectSchemaFail(
  type: string,
  doc: unknown,
  errorPattern: RegExp,
): Promise<void> {
  const r = await validateAff(type, doc);
  expect(r.status).toBe('fail');
  const allText = r.errors.map((e) => `${e.instancePath} ${e.keyword}: ${e.message}`).join(' | ');
  if (!errorPattern.test(allText)) {
    throw new Error(`expected error matching ${errorPattern}, got: ${allText}`);
  }
}

/** Best-effort type inference from filename; explicit `type` arg overrides. */
export function inferTypeFromName(rel: string): string {
  const m = rel.match(/\.([a-z]+)\.json$/);
  if (!m) throw new Error(`cannot infer type from ${rel}`);
  const code = m[1]!.toUpperCase();
  return code === 'STRU' ? 'STRU' : code;
}

/** Re-export for tests that want to format a result manually. */
export const _internals = { validateAff, formatLine, schemaPathFor };
