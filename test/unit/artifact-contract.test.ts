/**
 * `formats/artifact.ts` — shared contract for AFF JSON artifacts.
 *
 * The five pure-JSON format modules (TTYP / MSAG / DDLS / ENQU / NROB) no
 * longer repeat read/write/validate/load. These tests pin the contract so a
 * future artifact cannot drift in its I/O or error shape.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineJsonArtifact, defineWireArtifact, type JsonArtifact } from '../../src/abap_cli/formats/artifact.js';
import { ttypArtifact, type TtypLocal } from '../../src/abap_cli/formats/ttyp/json.js';
import { msagArtifact } from '../../src/abap_cli/formats/msag/json.js';

const VALID_TTYP: TtypLocal = {
  formatVersion: '1',
  header: { description: 'artifact contract', originalLanguage: 'EN' },
  accessType: 'standard',
  lineType: { rowType: 'string' },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-contract-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('defineJsonArtifact', () => {
  it('round-trips a document through write + read with a trailing newline', async () => {
    const artifact = defineJsonArtifact<TtypLocal>('TTYP');
    const file = path.join(dir, 'nested', 'zmy.ttyp.json');
    await artifact.write(file, VALID_TTYP);
    expect(fs.readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
    await expect(artifact.read(file)).resolves.toEqual(VALID_TTYP);
  });

  it('validate maps AFF schema errors to `<path>: <message>` strings', async () => {
    const artifact = defineJsonArtifact<unknown>('TTYP');
    const errors = await artifact.validate({ formatVersion: '1' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.includes(': '))).toBe(true);
  });

  it('load returns a valid document and throws AFF_FIXTURE_INVALID otherwise', async () => {
    const artifact = defineJsonArtifact<TtypLocal>('TTYP');
    const good = path.join(dir, 'zmy.ttyp.json');
    await artifact.write(good, VALID_TTYP);
    await expect(artifact.load(good)).resolves.toEqual(VALID_TTYP);

    const bad = path.join(dir, 'bad.ttyp.json');
    fs.writeFileSync(bad, JSON.stringify({ formatVersion: '1' }));
    await expect(artifact.load(bad)).rejects.toMatchObject({
      code: 'AFF_FIXTURE_INVALID',
      details: expect.any(Array),
    });
  });
});

describe('defineWireArtifact', () => {
  it('exposes the wire mapping alongside the file/schema plumbing', async () => {
    const artifact = defineWireArtifact<TtypLocal, string>({
      type: 'TTYP',
      toWire: ttypArtifact.toWire,
      fromWire: ttypArtifact.fromWire,
    });
    const wire = artifact.toWire(VALID_TTYP);
    expect(wire).toContain('<ttyp:lineType>string</ttyp:lineType>');
    expect(artifact.fromWire(wire).lineType.rowType).toBe('string');
  });

  it('the MSAG artifact rejects a document without messages', async () => {
    const msag: JsonArtifact<unknown> = msagArtifact;
    await expect(msag.validate({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' } })).resolves.toEqual(
      expect.arrayContaining([expect.stringContaining('messages')]),
    );
  });
});
