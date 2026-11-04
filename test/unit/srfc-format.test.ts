/**
 * SRFC (UCON RFC service) local document contract.
 *
 * Pins `srfc-v1.json` (local extension — upstream AFF has no SRFC format), the
 * local ↔ ICF wire mapping, the semantic rules the `/srfc/<name>` route
 * enforces and the UCONRFCSERVID name rules.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  localToWire,
  wireToLocal,
  validateSrfcObject,
  getSrfcJsonExample,
  normalizeSrfcScope,
  srfcArtifact,
  SRFC_NAME_MAX_LENGTH,
  type SrfcLocal,
  type SrfcWire,
} from '../../src/abap_cli/formats/srfc/json.js';
import { validateUconName } from '../../src/abap_cli/flows/edit/ucon-shared.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { routeType } from '../../src/abap_cli/aff/router.js';

const DOC: SrfcLocal = {
  formatVersion: '1',
  description: 'Default RFC Service for Function-Module: Z_MY_RFC_FM',
  functionName: 'Z_MY_RFC_FM',
  scope: 'E',
  defaultProfile: 'MY_UCON_PROFILE',
};

const WIRE: SrfcWire = {
  ...DOC,
  name: 'ZSRFC_DEMO',
  package: '$TMP',
  createdBy: 'SAP103',
  createdOn: '2026-01-01',
  createdAt: '12:00:00',
  changedBy: 'SAP103',
  changedOn: '2026-01-02',
  changedAt: '01:02:03',
};

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'src', 'abap_cli', 'schema', 'srfc-v1.json',
);

describe('formats/srfc/json.ts (local extension)', () => {
  it('resolves the schema path and file suffix', () => {
    expect(schemaPathFor('SRFC')).toBe(SCHEMA_PATH);
    expect(routeType('src/zsrfc_demo.srfc.json')).toBe('SRFC');
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
  });

  it('validates the local document against srfc-v1.json', async () => {
    await expect(srfcArtifact.validate(DOC)).resolves.toEqual([]);

    const errors = await srfcArtifact.validate({ formatVersion: '1' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('; ')).toContain('functionName');
  });

  it('rejects unknown document fields (strict local extension schema)', async () => {
    const errors = await srfcArtifact.validate({ ...DOC, package: '$TMP' });
    expect(errors.join('; ')).toMatch(/additional properties/);
  });

  it('rejects an out-of-domain scope and an over-long description', async () => {
    const errors = await validateSrfcObject({
      formatVersion: '1',
      functionName: 'Z_MY_RFC_FM',
      scope: 'X',
      description: 'x'.repeat(256),
    });
    expect(errors.join('; ')).toContain('scope must be one of');
    expect(errors.join('; ')).toContain('description must not exceed 255');
  });

  it('load rejects an invalid file with AFF_FIXTURE_INVALID', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srfc-format-'));
    try {
      const file = path.join(dir, 'zsrfc_bad.srfc.json');
      fs.writeFileSync(file, JSON.stringify({ formatVersion: '1', scope: 'E' }));
      await expect(srfcArtifact.load(file)).rejects.toMatchObject({ code: 'AFF_FIXTURE_INVALID' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wireToLocal drops the server-owned fields and normalizes values', () => {
    const local = wireToLocal({
      ...WIRE,
      description: '  Service text  ',
      functionName: ' z_my_rfc_fm ',
      scope: 'e',
    });
    expect(local).toEqual({
      formatVersion: '1',
      description: 'Service text',
      functionName: 'Z_MY_RFC_FM',
      scope: 'E',
      defaultProfile: 'MY_UCON_PROFILE',
    });
    expect('name' in local).toBe(false);
    expect('package' in local).toBe(false);
    expect('createdBy' in local).toBe(false);
  });

  it('wireToLocal omits an empty scope / default profile', () => {
    const local = wireToLocal({
      name: 'ZSRFC_DEMO',
      description: '',
      functionName: 'Z_MY_RFC_FM',
      scope: '',
      defaultProfile: '',
      package: '$TMP',
    });
    expect(local).toMatchObject({ formatVersion: '1', functionName: 'Z_MY_RFC_FM' });
    expect(local.scope).toBeUndefined();
    expect(local.defaultProfile).toBeUndefined();
  });

  it('localToWire adds the name and stays round-trip stable', () => {
    const wire = localToWire(DOC, 'zsrfc_demo');
    expect(wire).toEqual({ ...DOC, name: 'ZSRFC_DEMO' });
    expect(wireToLocal(wire)).toEqual(DOC);
  });

  it('normalizes a scope value; unknown / empty values are dropped', () => {
    expect(normalizeSrfcScope('e')).toBe('E');
    expect(normalizeSrfcScope('S')).toBe('S');
    expect(normalizeSrfcScope('')).toBeUndefined();
    expect(normalizeSrfcScope('X')).toBeUndefined();
    expect(normalizeSrfcScope(undefined)).toBeUndefined();
  });

  it('documents the required fields in the agent-facing example', () => {
    const example = getSrfcJsonExample();
    expect(example).toContain('"functionName"');
    expect(example).toContain('"scope"');
    expect(example).toContain('RFC-enabled');
  });

  it('validates the UCONRFC valid name rules locally', () => {
    const spec = { type: 'SRFC', label: 'UCON RFC service', maxLength: SRFC_NAME_MAX_LENGTH, example: 'x' };
    expect(validateUconName(' zsrfc_demo ', spec)).toBe('ZSRFC_DEMO');
    expect(() => validateUconName('', spec)).toThrow(/must not be empty/);
    expect(() => validateUconName('Z' + 'X'.repeat(SRFC_NAME_MAX_LENGTH), spec)).toThrow(/at most 30/);
    expect(() => validateUconName('ZSRFC DEMO', spec)).toThrow(/whitespace/);
  });
});
