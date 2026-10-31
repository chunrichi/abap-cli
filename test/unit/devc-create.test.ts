/**
 * DEVC create flow (`abap create DEVC`) driven through the real command layer
 * with a mocked ADT client.
 *
 * Covers: super-package defaults, flag overrides, `--check-only` (SAP name
 * preflight), the LOCAL name guard, create-then-pull local write + draft
 * protection, and the flag rejection paths.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from '../../src/abap_cli/output/json.js';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

const getPackage = vi.fn();
const createPackage = vi.fn();
const validatePackage = vi.fn();
const logout = vi.fn();

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      getPackage,
      createPackage,
      validatePackage,
      logout,
      getConfig: () => ({ sap: { username: 'mockuser' } }),
    }),
  },
}));

function packageXml(name: string, overrides: Record<string, string> = {}): string {
  const description = overrides.description ?? `package ${name}`;
  const superPackage = overrides.superPackage ?? '';
  const softwareComponent = overrides.softwareComponent ?? 'LOCAL';
  const attributes = overrides.attributes ?? 'pak:packageType="development" pak:isAddingObjectsAllowed="false" pak:isEncapsulated="false" pak:recordChanges="false" pak:languageVersion=""';
  return `<?xml version="1.0" encoding="utf-8"?><pak:package xmlns:pak="http://www.sap.com/adt/packages" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:responsible="MOCKUSER" adtcore:masterLanguage="EN" adtcore:name="${name}" adtcore:type="DEVC/K" adtcore:version="active" adtcore:description="${description}" adtcore:language="EN"><pak:attributes ${attributes}/>${
    superPackage ? `<pak:superPackage adtcore:type="DEVC/K" adtcore:name="${superPackage}"/>` : '<pak:superPackage/>'
  }<pak:applicationComponent pak:name=""/><pak:transport><pak:softwareComponent pak:name="${softwareComponent}"/><pak:transportLayer pak:name=""/></pak:transport><pak:useAccesses pak:isVisible="false"/><pak:subPackages/></pak:package>`;
}

let cwd: string;

beforeEach(() => {
  vi.clearAllMocks();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'devc-create-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  getPackage.mockImplementation(async (name: string) => {
    if (name === '$TMP') return packageXml('$TMP', { description: 'Temporary Objects (never transported!)' });
    if (name === '$ZCLI_TC_PKG01') return packageXml('$ZCLI_TC_PKG01', { superPackage: '$TMP', description: 'created package' });
    throw new CliError('OBJECT_NOT_FOUND', `Package ${name} not found`, { object: name, type: 'DEVC' });
  });
  createPackage.mockResolvedValue(undefined);
  validatePackage.mockResolvedValue({ success: true, severity: 'OK', message: '' });
});

function run(args: string[]) {
  const program = makeProgram();
  registerCreateCommand(program);
  return runCommand(program, [...args, '--json'], { cwd });
}

describe('create DEVC — happy path', () => {
  it('inherits the software component from $TMP and writes the local .devc.json', async () => {
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'created package', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(createPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '$ZCLI_TC_PKG01',
        description: 'created package',
        parentName: '$TMP',
        softwareComponent: 'LOCAL',
        transportLayer: '',
        packageType: 'development',
        responsible: 'MOCKUSER',
      }),
    );
    const envelope = JSON.parse(res.stdout);
    expect(envelope.data).toMatchObject({
      object: '$ZCLI_TC_PKG01',
      type: 'DEVC',
      action: 'created',
      channel: 'adt',
      superPackage: '$TMP',
      softwareComponent: 'LOCAL',
      localFile: 'src/$zcli_tc_pkg01.devc.json',
    });
    const written = JSON.parse(fs.readFileSync(path.join(cwd, 'src', '$zcli_tc_pkg01.devc.json'), 'utf8'));
    expect(written).toMatchObject({
      formatVersion: '1',
      generalInformation: { type: 'development', superPackage: '$TMP', softwareComponent: 'LOCAL' },
    });
  });

  it('honours --software-component / --transport-layer / --package-type overrides', async () => {
    getPackage.mockImplementation(async (name: string) => {
      if (name === 'ZPARENT') {
        return packageXml('ZPARENT', { superPackage: 'ZROOT', softwareComponent: 'HOME' });
      }
      return packageXml(name, { superPackage: 'ZPARENT', softwareComponent: 'HOME' });
    });
    const res = await run([
      'create', 'DEVC', 'ZCHILD', '--package', 'ZPARENT', '--description', 'child package',
      '--software-component', 'ZLOCAL', '--transport-layer', 'SAP', '--package-type', 'main', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(createPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ZCHILD',
        parentName: 'ZPARENT',
        softwareComponent: 'ZLOCAL',
        transportLayer: 'SAP',
        packageType: 'main',
      }),
    );
  });

  it('--no-pull skips the local file', async () => {
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'x', '--no-pull', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(JSON.parse(res.stdout).data.localFile).toBeUndefined();
    expect(fs.existsSync(path.join(cwd, 'src', '$zcli_tc_pkg01.devc.json'))).toBe(false);
  });

  it('keeps an existing local draft and reports LOCAL_FILE_KEPT', async () => {
    const draftPath = path.join(cwd, 'src', '$zcli_tc_pkg01.devc.json');
    fs.writeFileSync(draftPath, '{ "formatVersion": "1", "draft": true }\n');
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'x', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    const envelope = JSON.parse(res.stdout);
    expect(envelope.meta.warnings.map((w: { code: string }) => w.code)).toContain('LOCAL_FILE_KEPT');
    expect(fs.readFileSync(draftPath, 'utf8')).toBe('{ "formatVersion": "1", "draft": true }\n');
  });
});

describe('create DEVC — check-only preflight', () => {
  it('passes SAP validation through without creating', async () => {
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'x', '--check-only', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(createPackage).not.toHaveBeenCalled();
    expect(validatePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '$ZCLI_TC_PKG01',
        parentName: '$TMP',
        softwareComponent: 'LOCAL',
        packageType: 'development',
      }),
    );
    expect(JSON.parse(res.stdout).data).toMatchObject({
      object: '$ZCLI_TC_PKG01',
      checkOnly: true,
      valid: true,
      superPackage: '$TMP',
    });
  });

  it("reports SAP's rejection for a LOCAL name without the prefix", async () => {
    validatePackage.mockResolvedValue({
      success: false,
      severity: 'ERROR',
      message: "Names of LOCAL packages must start with '$' or 'TEST'",
    });
    const res = await run([
      'create', 'DEVC', 'ZNOT_LOCAL', '--package', '$TMP', '--description', 'x', '--check-only', '--yes',
    ]);
    expect(res.exitCode).toBeUndefined();
    expect(createPackage).not.toHaveBeenCalled();
    expect(JSON.parse(res.stdout).data).toMatchObject({
      valid: false,
      issues: ["Names of LOCAL packages must start with '$' or 'TEST'"],
    });
  });
});

describe('create DEVC — validation and rejection paths', () => {
  it('rejects a LOCAL package name without $/TEST before touching SAP', async () => {
    const res = await run([
      'create', 'DEVC', 'ZNOT_LOCAL', '--package', '$TMP', '--description', 'x', '--yes',
    ]);
    expect(res.exitCode).toBe(7);
    expect(createPackage).not.toHaveBeenCalled();
    const envelope = JSON.parse(res.stderr);
    expect(envelope.error.code).toBe('VALIDATION_ERROR');
    expect(envelope.error.message).toContain("Names of LOCAL packages must start with '$' or 'TEST'");
  });

  it('rejects an illegal package name shape', async () => {
    const res = await run(['create', 'DEVC', 'Z PKG', '--package', '$TMP', '--description', 'x', '--yes']);
    expect(res.exitCode).toBe(7);
    expect(createPackage).not.toHaveBeenCalled();
  });

  it('rejects an invalid --package-type', async () => {
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'x', '--package-type', 'weird', '--yes',
    ]);
    expect(res.exitCode).toBe(2);
    expect(createPackage).not.toHaveBeenCalled();
    expect(JSON.parse(res.stderr).error.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects --file for DEVC', async () => {
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'x', '--file', 'pkg.devc.json', '--yes',
    ]);
    expect(res.exitCode).toBe(2);
    expect(createPackage).not.toHaveBeenCalled();
  });

  it('rejects --template for DEVC', async () => {
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'x', '--template', 'minimal', '--yes',
    ]);
    expect(res.exitCode).toBe(2);
    expect(createPackage).not.toHaveBeenCalled();
    expect(JSON.parse(res.stderr).error.code).toBe('INVALID_ARGUMENT');
  });

  it('reports OBJECT_NOT_FOUND when the super package does not exist', async () => {
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$MISSING', '--description', 'x', '--yes',
    ]);
    expect(res.exitCode).toBe(8);
    expect(JSON.parse(res.stderr).error.code).toBe('OBJECT_NOT_FOUND');
    expect(JSON.parse(res.stderr).error.message).toContain('Super package $MISSING not found');
  });

  it('maps a create failure to CREATE_FAILED', async () => {
    createPackage.mockRejectedValue(new CliError('SAP_ERROR', 'No authorization for package creation'));
    const res = await run([
      'create', 'DEVC', '$ZCLI_TC_PKG01', '--package', '$TMP', '--description', 'x', '--yes',
    ]);
    expect(res.exitCode).toBe(7);
    expect(JSON.parse(res.stderr).error.code).toBe('CREATE_FAILED');
    expect(JSON.parse(res.stderr).error.message).toContain('No authorization for package creation');
  });
});
