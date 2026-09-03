import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  resolveMirrorRoot,
  schemaPathFor,
  affSupportedTypes,
} from '../../src/abap_cli/aff/schema-paths.js';

const AFF_MIRROR_ENV = 'ABAP_CLI_AFF_MIRROR';
const BUNDLED_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'src', 'abap_cli', 'schema',
);

describe('schema-paths priority chain', () => {
  const savedEnv = process.env[AFF_MIRROR_ENV];

  beforeEach(() => {
    delete process.env[AFF_MIRROR_ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[AFF_MIRROR_ENV];
    else process.env[AFF_MIRROR_ENV] = savedEnv;
  });

  it('default source is bundled (not tmp/)', () => {
    const r = resolveMirrorRoot();
    expect(r.source).toBe('bundled');
    expect(r.root).toBe(BUNDLED_ROOT);
  });

  it('env override wins over bundled', () => {
    process.env[AFF_MIRROR_ENV] = '/tmp/custom-aff-mirror';
    const r = resolveMirrorRoot();
    expect(r.source).toBe('env');
    expect(r.root).toBe('/tmp/custom-aff-mirror');
  });

  it('schemaPathFor uses bundled root by default and returns flat filenames', () => {
    expect(schemaPathFor('CLAS')).toBe(path.join(BUNDLED_ROOT, 'clas-v1.json'));
    expect(schemaPathFor('TABL')).toBe(path.join(BUNDLED_ROOT, 'tabl-v1.json'));
    expect(schemaPathFor('STRU')).toBe(path.join(BUNDLED_ROOT, 'tabl-v1.json'));
  });

  it('schemaFileOverride honours tabt-v1.json for TABL settings', () => {
    expect(schemaPathFor('TABL', undefined, 'tabt-v1.json')).toBe(
      path.join(BUNDLED_ROOT, 'tabt-v1.json'),
    );
    expect(schemaPathFor('STRU', undefined, 'tabt-v1.json')).toBe(
      path.join(BUNDLED_ROOT, 'tabt-v1.json'),
    );
  });

  it('affSupportedTypes matches the router table (10 router types + TABT override)', () => {
    const types = affSupportedTypes();
    expect(types).toEqual(
      expect.arrayContaining(['CLAS', 'INTF', 'PROG', 'FUGR', 'TABL', 'STRU', 'TABT', 'DOMA', 'DTEL', 'HTTP', 'TRAN']),
    );
    // TABT is exposed as a schema key for the .settings.json override path.
    expect(types).toHaveLength(11);
  });

  it('bundled root contains every supported schema', () => {
    expect(fs.existsSync(BUNDLED_ROOT)).toBe(true);
    for (const type of affSupportedTypes()) {
      const file = type === 'STRU' ? 'tabl-v1.json' : `${type.toLowerCase()}-v1.json`;
      expect(
        fs.existsSync(path.join(BUNDLED_ROOT, file)),
        `bundled schema missing: ${file}`,
      ).toBe(true);
    }
  });

  it('bundled tabt-v1.json is present (TABL settings)', () => {
    expect(fs.existsSync(path.join(BUNDLED_ROOT, 'tabt-v1.json'))).toBe(true);
  });
});
