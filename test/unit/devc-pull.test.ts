/**
 * DEVC pull flow (`abap pull <name> --type DEVC`).
 *
 * One ADT package resource in, one `<name>.devc.json` out. The flow owns the
 * file-conflict semantics (skip / overwrite / OVERWRITE_REQUIRED) so the tests
 * pin them at the flow boundary.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from '../../src/abap_cli/output/json.js';
import { runPullDevc } from '../../src/abap_cli/flows/edit/pull-devc.js';

const getPackage = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({ getPackage }),
  },
}));

function packageXml(name: string): string {
  const token = name.startsWith('/')
    ? `(ns)${name.split('/').pop()!.toLowerCase()}`
    : name.toLowerCase();
  return `<?xml version="1.0" encoding="utf-8"?><pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:responsible="MOCKUSER" adtcore:masterLanguage="EN" adtcore:name="${name}" adtcore:type="DEVC/K" adtcore:version="active" adtcore:description="package ${token}" adtcore:language="EN"><pak:attributes pak:packageType="development" pak:isAddingObjectsAllowed="false" pak:isEncapsulated="false" pak:recordChanges="false" pak:languageVersion=""/><pak:superPackage/><pak:applicationComponent pak:name=""/><pak:transport><pak:softwareComponent pak:name="LOCAL"/><pak:transportLayer pak:name=""/></pak:transport><pak:useAccesses pak:isVisible="false"/><pak:subPackages/></pak:package>`;
}

let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'devc-pull-'));
  getPackage.mockImplementation(async (name: string) => {
    if (name === '$TMP') return packageXml('$TMP');
    if (name === '$ZCLI_TC_PKG01') return packageXml('$ZCLI_TC_PKG01');
    if (name === '/MOCK/NS_PKG') return packageXml('/MOCK/NS_PKG');
    throw new CliError('OBJECT_NOT_FOUND', `Package ${name} not found`, { object: name, type: 'DEVC' });
  });
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

const opts = () => ({ dir: path.join(cwd, 'src') });

describe('pull DEVC', () => {
  it('writes <name>.devc.json and returns the standard pull envelope', async () => {
    const result = await runPullDevc('$ZCLI_TC_PKG01', opts());
    expect(getPackage).toHaveBeenCalledWith('$ZCLI_TC_PKG01');
    expect(result.data).toMatchObject({
      object: '$ZCLI_TC_PKG01',
      type: 'DEVC',
      written: 1,
      skipped: 0,
      failed: 0,
      channel: 'adt',
    });
    const written = JSON.parse(fs.readFileSync(path.join(cwd, 'src', '$zcli_tc_pkg01.devc.json'), 'utf8'));
    expect(written).toMatchObject({
      formatVersion: '1',
      header: { description: 'package $zcli_tc_pkg01', originalLanguage: 'en' },
      generalInformation: { type: 'development', softwareComponent: 'LOCAL' },
    });
    expect(result.human).toContain('wrote');
  });

  it('uses the abap-file-format namespace token for namespaced packages', async () => {
    const result = await runPullDevc('/mock/ns_pkg', opts());
    expect(result.data).toMatchObject({ object: '/MOCK/NS_PKG', written: 1 });
    expect(fs.existsSync(path.join(cwd, 'src', '(mock)ns_pkg.devc.json'))).toBe(true);
  });

  it('skips when the local file already matches', async () => {
    await runPullDevc('$ZCLI_TC_PKG01', opts());
    const second = await runPullDevc('$ZCLI_TC_PKG01', opts());
    expect(second.data).toMatchObject({ written: 0, skipped: 1 });
    expect(second.human).toContain('skipped');
  });

  it('refuses to overwrite a differing local file without --overwrite', async () => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', '$zcli_tc_pkg01.devc.json'), '{}\n');
    await expect(runPullDevc('$ZCLI_TC_PKG01', opts())).rejects.toMatchObject({
      code: 'OVERWRITE_REQUIRED',
    });
  });

  it('--overwrite replaces the local file', async () => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    const target = path.join(cwd, 'src', '$zcli_tc_pkg01.devc.json');
    fs.writeFileSync(target, '{}\n');
    await runPullDevc('$ZCLI_TC_PKG01', { ...opts(), overwrite: true });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toMatchObject({ formatVersion: '1' });
  });

  it('--skip-existing keeps the local file', async () => {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    const target = path.join(cwd, 'src', '$zcli_tc_pkg01.devc.json');
    fs.writeFileSync(target, '{}\n');
    const result = await runPullDevc('$ZCLI_TC_PKG01', { ...opts(), skipExisting: true });
    expect(result.data).toMatchObject({ written: 0, skipped: 1 });
    expect(fs.readFileSync(target, 'utf8')).toBe('{}\n');
  });

  it('surfaces OBJECT_NOT_FOUND for a missing package', async () => {
    await expect(runPullDevc('$NO_SUCH', opts())).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });
});
