/**
 * SM59 (HTTP destination) local document contract.
 *
 * Pins `sm59-v1.json` (local extension — upstream AFF has no SM59 format), the
 * local ↔ ICF wire mapping, the semantic rules the `/sm59/<name>` route
 * enforces and the RFCDEST name rules.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  localToWire,
  wireToLocal,
  validateSm59Object,
  getSm59JsonExample,
  normalizeSm59Protocol,
  sm59Artifact,
  SM59_NAME_MAX_LENGTH,
  type Sm59Local,
  type Sm59Wire,
} from '../../src/abap_cli/formats/sm59/json.js';
import {
  assertSm59FileNameMatches,
  normalizeSm59Name,
  rejectSm59PackageAndTransport,
  validateSm59Name,
} from '../../src/abap_cli/flows/edit/sm59-shared.js';
import { schemaPathFor } from '../../src/abap_cli/aff/schema-paths.js';
import { routeType } from '../../src/abap_cli/aff/router.js';

const DOC: Sm59Local = {
  formatVersion: '1',
  description: 'Demo HTTP destination',
  targetHost: 'example.com',
  port: 443,
  protocol: 'HTTPS',
  pathPrefix: '/api',
};

const WIRE: Sm59Wire = {
  ...DOC,
  name: 'ZSM59_DEMO',
  type: 'G',
};

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'src', 'abap_cli', 'schema', 'sm59-v1.json',
);

describe('formats/sm59/json.ts (local extension)', () => {
  it('resolves the schema path and file suffix', () => {
    expect(schemaPathFor('SM59')).toBe(SCHEMA_PATH);
    expect(routeType('src/zsm59_demo.sm59.json')).toBe('SM59');
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
  });

  it('validates the local document against sm59-v1.json', async () => {
    await expect(sm59Artifact.validate(DOC)).resolves.toEqual([]);

    const errors = await sm59Artifact.validate({ formatVersion: '1' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('; ')).toContain('targetHost');
  });

  it('rejects unknown document fields (strict local extension schema)', async () => {
    const errors = await sm59Artifact.validate({ ...DOC, package: '$TMP' });
    expect(errors.join('; ')).toMatch(/additional properties/);
  });

  it('load rejects an invalid file with AFF_FIXTURE_INVALID', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm59-format-'));
    try {
      const file = path.join(dir, 'zsm59_bad.sm59.json');
      fs.writeFileSync(file, JSON.stringify({ formatVersion: '1', protocol: 'SMTP', targetHost: 'example.com' }));
      await expect(sm59Artifact.load(file)).rejects.toMatchObject({ code: 'AFF_FIXTURE_INVALID' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wireToLocal drops the server-owned identity fields and normalizes values', () => {
    const local = wireToLocal({
      name: 'ZSM59_DEMO',
      type: 'G',
      formatVersion: '1',
      description: '  Demo HTTP destination  ',
      targetHost: '  example.com ',
      port: '443',
      protocol: 'https',
      pathPrefix: '/api',
    });
    expect(local).toEqual(DOC);
    expect('name' in local).toBe(false);
    expect('type' in local).toBe(false);
  });

  it('wireToLocal omits the port when the server does not report one', () => {
    // GET reports the stored SERVICE_NUMBER; SAP entries without one yield 0
    // (or no field), which must not become a local `"port": 0`.
    for (const port of [undefined, 0, null, '0', '']) {
      const local = wireToLocal({ targetHost: 'example.com', protocol: 'HTTP', ...(port === undefined ? {} : { port }) });
      expect(local).toMatchObject({ formatVersion: '1', targetHost: 'example.com', protocol: 'HTTP' });
      expect(local.port).toBeUndefined();
    }
  });

  it('localToWire adds name + read-only RFCTYPE and stays round-trip stable', () => {
    const wire = localToWire(DOC, 'zsm59_demo');
    expect(wire).toEqual(WIRE);
    // pull → push round-trip: the wire document maps back to the same local file.
    expect(wireToLocal(wire)).toEqual(DOC);
  });

  it('normalizes an unknown / empty protocol to HTTPS', () => {
    expect(normalizeSm59Protocol('http')).toBe('HTTP');
    expect(normalizeSm59Protocol('HTTPS')).toBe('HTTPS');
    expect(normalizeSm59Protocol(undefined)).toBe('HTTPS');
    expect(normalizeSm59Protocol('smtp')).toBe('HTTPS');
  });

  it('validateSm59Object reports semantic errors beyond the schema', () => {
    expect(validateSm59Object({})).toEqual(
      expect.arrayContaining([expect.stringContaining('targetHost'), expect.stringContaining('protocol')]),
    );
    expect(validateSm59Object({ targetHost: 'example.com', protocol: 'SMTP' }).join('; ')).toContain('protocol must be one of');
    expect(validateSm59Object({ targetHost: 'example.com', protocol: 'HTTPS', port: 70000 }).join('; ')).toContain('port');
    // RFCDOC_D is CHAR 72, single line.
    expect(validateSm59Object({ targetHost: 'example.com', protocol: 'HTTPS', description: 'x'.repeat(73) }).join('; ')).toContain('72');
    expect(validateSm59Object({ targetHost: 'example.com', protocol: 'HTTPS', description: 'line 1\nline 2' }).join('; ')).toContain('single line');
    expect(validateSm59Object({ targetHost: 'example.com', protocol: 'HTTPS', description: 'x'.repeat(72) })).toEqual([]);
  });

  it('ships a parseable agent-facing example', () => {
    const jsonPart = getSm59JsonExample()
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    const example = JSON.parse(jsonPart) as Record<string, unknown>;
    expect(example.formatVersion).toBe('1');
    expect(example.targetHost).toBeTypeOf('string');
    expect(example.protocol).toBe('HTTPS');
  });
});

describe('flows/edit/sm59-shared.ts (RFCDEST rules)', () => {
  it('accepts real-world destination names and uppercases them', () => {
    expect(validateSm59Name('zsm59_demo')).toBe('ZSM59_DEMO');
    // Real S/4HANA destinations: hyphen, @ and dot occur.
    expect(validateSm59Name('SAP-SUPPORT_NOTE_DOWNLOAD')).toBe('SAP-SUPPORT_NOTE_DOWNLOAD');
    expect(validateSm59Name('s4h_000@cif_ccms')).toBe('S4H_000@CIF_CCMS');
    expect(validateSm59Name('vhcals4hci.client')).toBe('VHCALS4HCI.CLIENT');
    expect(validateSm59Name('X'.repeat(SM59_NAME_MAX_LENGTH))).toHaveLength(SM59_NAME_MAX_LENGTH);
    expect(normalizeSm59Name('  zsm59_demo ')).toBe('ZSM59_DEMO');
  });

  it('rejects empty, over-long and whitespace names with SM59_NAME_INVALID', () => {
    expect(() => validateSm59Name('')).toThrow(/must not be empty/);
    expect(() => validateSm59Name('   ')).toThrow(/must not be empty/);
    expect(() => validateSm59Name('X'.repeat(SM59_NAME_MAX_LENGTH + 1))).toThrow(/at most 32 characters/);
    expect(() => validateSm59Name('BAD NAME')).toThrow(/whitespace or control characters/);
    expect(() => validateSm59Name('BAD\tNAME')).toThrow(/whitespace or control characters/);
    for (const bad of ['', '   ', 'BAD NAME']) {
      try {
        validateSm59Name(bad);
      } catch (error) {
        expect(error).toMatchObject({ code: 'SM59_NAME_INVALID' });
      }
    }
  });

  it('rejects --package / --tr with TYPE_NOT_SUPPORTED (no silent drop)', () => {
    for (const action of ['create', 'push', 'delete'] as const) {
      expect(() => rejectSm59PackageAndTransport({}, action)).not.toThrow();
      expect(() => rejectSm59PackageAndTransport({ package: '$TMP' }, action)).toThrow(/drop --package/);
      expect(() => rejectSm59PackageAndTransport({ tr: 'NDK900123' }, action)).toThrow(/drop --tr/);
    }
    try {
      rejectSm59PackageAndTransport({ package: '$TMP' }, 'create');
    } catch (error) {
      expect(error).toMatchObject({ code: 'TYPE_NOT_SUPPORTED' });
    }
  });

  it('rejects a --file whose name does not match the destination', () => {
    expect(() => assertSm59FileNameMatches('ZSM59_DEMO', '/tmp/zsm59_demo.sm59.json')).not.toThrow();
    expect(() => assertSm59FileNameMatches('ZSM59_DEMO', '/tmp/zsm59_other.sm59.json')).toThrow(/does not match/);
    // Namespaced names use the AFF `(ns)name` token.
    expect(() => assertSm59FileNameMatches('/NS/NAME', '/tmp/(ns)name.sm59.json')).not.toThrow();
  });
});
