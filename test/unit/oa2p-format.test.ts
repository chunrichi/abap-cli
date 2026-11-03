/**
 * OA2P (OAuth 2.0 client profile) local document contract.
 *
 * Pins `oa2p-v1.json` (local extension — upstream AFF has no OA2P format), the
 * local ↔ ICF wire mapping, the semantic rules the `/oa2p/<name>` route
 * enforces and the OA2C_PROFILE name rules.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  localToWire,
  wireToLocal,
  validateOa2pObject,
  getOa2pJsonExample,
  normalizeOa2pScopes,
  oa2pArtifact,
  OA2P_NAME_MAX_LENGTH,
  type Oa2pLocal,
  type Oa2pWire,
} from '../../src/abap_cli/formats/oa2p/json.js';
import { validateUconName } from '../../src/abap_cli/flows/edit/ucon-shared.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { routeType } from '../../src/abap_cli/aff/router.js';

const DOC: Oa2pLocal = {
  formatVersion: '1',
  type: 'DEFAULT',
  noAuthCheck: false,
  scopes: ['scope-one', 'scope-two'],
};

const WIRE: Oa2pWire = {
  ...DOC,
  name: 'ZOA2P_DEMO',
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
  '..', '..', 'src', 'abap_cli', 'schema', 'oa2p-v1.json',
);

describe('formats/oa2p/json.ts (local extension)', () => {
  it('resolves the schema path and file suffix', () => {
    expect(schemaPathFor('OA2P')).toBe(SCHEMA_PATH);
    expect(routeType('src/zoa2p_demo.oa2p.json')).toBe('OA2P');
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
  });

  it('validates the local document against oa2p-v1.json', async () => {
    await expect(oa2pArtifact.validate(DOC)).resolves.toEqual([]);

    const errors = await oa2pArtifact.validate({ formatVersion: '1' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('; ')).toContain('type');
  });

  it('rejects unknown document fields (strict local extension schema)', async () => {
    const errors = await oa2pArtifact.validate({ ...DOC, description: 'nope' });
    expect(errors.join('; ')).toMatch(/additional properties/);
  });

  it('rejects an over-long type and empty scope entries', async () => {
    const errors = await validateOa2pObject({
      formatVersion: '1',
      type: 'X'.repeat(21),
      scopes: ['ok', ''],
    });
    expect(errors.join('; ')).toContain('type must not exceed 20');
    expect(errors.join('; ')).toContain('scopes[1] must be a non-empty string');
  });

  it('load rejects an invalid file with AFF_FIXTURE_INVALID', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa2p-format-'));
    try {
      const file = path.join(dir, 'zoa2p_bad.oa2p.json');
      fs.writeFileSync(file, JSON.stringify({ formatVersion: '1', noAuthCheck: 'yes' }));
      await expect(oa2pArtifact.load(file)).rejects.toMatchObject({ code: 'AFF_FIXTURE_INVALID' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wireToLocal drops the server-owned fields and normalizes values', () => {
    const local = wireToLocal({
      ...WIRE,
      type: ' default ',
      noAuthCheck: true,
      scopes: [' scope-one ', ''],
    });
    expect(local).toEqual({
      formatVersion: '1',
      type: 'DEFAULT',
      noAuthCheck: true,
      scopes: ['scope-one'],
    });
    expect('name' in local).toBe(false);
    expect('package' in local).toBe(false);
    expect('createdBy' in local).toBe(false);
  });

  it('localToWire adds the name and stays round-trip stable', () => {
    const wire = localToWire(DOC, 'zoa2p_demo');
    expect(wire).toEqual({ ...DOC, name: 'ZOA2P_DEMO' });
    expect(wireToLocal(wire)).toEqual(DOC);
  });

  it('normalizes the scope list: drops empty / non-string entries, keeps order', () => {
    expect(normalizeOa2pScopes([' b ', 'a', '', 7, null])).toEqual(['b', 'a']);
    expect(normalizeOa2pScopes(undefined)).toEqual([]);
  });

  it('documents the required fields in the agent-facing example', () => {
    const example = getOa2pJsonExample();
    expect(example).toContain('"type"');
    expect(example).toContain('"scopes"');
    expect(example).toContain('OA2C_TYPES');
  });

  it('validates the OA2C profile name rules locally', () => {
    const spec = { type: 'OA2P', label: 'OAuth2 profile', maxLength: OA2P_NAME_MAX_LENGTH, example: 'x' };
    expect(validateUconName(' zoa2p_demo ', spec)).toBe('ZOA2P_DEMO');
    expect(() => validateUconName('', spec)).toThrow(/must not be empty/);
    expect(() => validateUconName('Z' + 'X'.repeat(OA2P_NAME_MAX_LENGTH), spec)).toThrow(/at most 30/);
    expect(() => validateUconName('ZOA2P DEMO', spec)).toThrow(/whitespace/);
  });
});
