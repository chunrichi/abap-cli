/**
 * Generic AFF-over-ICF channel — registry, local bundle layout and validation.
 *
 * The six AFF bundle types (APLO / CHDO / EVTB / SMBC / ENHO / ENHS) share one
 * implementation. SAP's AFF framework owns the file set, so the CLI side is
 * deliberately thin: filenames are the AFF identity (`<token>.<type>.json`),
 * the bundle is discovered by that prefix in one flat directory, and the object
 * document is validated against the vendored schema before it is sent.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  affLocalPrefix,
  affMainFileName,
  assertAffMainFile,
  applyAffDescription,
  discoverAffBundleFiles,
  hasAffMainFile,
  isAffBundleFileName,
  readAffBundle,
  readValidatedAffBundle,
  safeAffOutputName,
  validateAffBundle,
  type AffBundleFile,
} from '../../src/abap_cli/formats/aff/bundle.js';
import {
  AFF_BUNDLE_TYPES,
  affBundleTypeFor,
  affChannelFor,
  affSchemaFileFor,
  createUnsupportedReasonFor,
  deleteUnsupportedReasonFor,
  isAffBundleType,
  maxNameLengthFor,
  pushUnsupportedReasonFor,
  sourceFor,
  requiresFileFor,
} from '../../src/abap_cli/types/registry.js';
import { typeCatalog } from '../../src/abap_cli/flows/setup/types-catalog.js';
import { TYPE_ROUTES } from '../../src/abap_cli/flows/edit/routing.js';
import { affTransportFor } from '../../src/abap_cli/flows/edit/aff-shared.js';
import { deduplicateAffBundleTargets } from '../../src/abap_cli/flows/edit/push-dedup.js';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';
import { CliError } from '../../src/abap_cli/output/json.js';

/** Minimal valid document per type (only the schema-required fields). */
const HEADER = { description: 'mock AFF object', originalLanguage: 'en' };
const VALID_DOCS: Record<string, Record<string, unknown>> = {
  APLO: { formatVersion: '1', header: HEADER, subobjects: [] },
  CHDO: {
    formatVersion: '1',
    header: HEADER,
    tablesAndStructures: [],
    errorMessage: { id: 'MOCK', number: '001' },
  },
  EVTB: {
    formatVersion: '1',
    header: HEADER,
    producerNamespace: 'MOCK',
    boName: 'MOCK',
    boOperation: 'mock',
    events: [],
  },
  SMBC: {
    formatVersion: '1',
    header: HEADER,
    serviceConfiguration: {
      serviceBinding: 'MOCK',
      serviceName: 'MOCK',
      serviceVersion: '1',
      rootEntitySet: 'MOCK',
      name: 'MOCK',
    },
  },
  ENHO: {
    formatVersion: '1',
    header: HEADER,
    enhancementSpot: 'MOCK',
    badiImplementations: [],
    referencedObjects: [],
  },
  ENHS: { formatVersion: '1', header: HEADER, configuration: { tool: 'badiDefinition' } },
};
const VALID_ENHS = VALID_DOCS.ENHS!;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aff-bundle-'));
}

function write(dir: string, name: string, content: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof CliError) return error.code;
    throw error;
  }
  throw new Error('expected a CliError');
}

describe('AFF bundle local naming', () => {
  it('builds the flat AFF prefix and main document name', () => {
    expect(affLocalPrefix('ZCLI_AFF_ENHS', 'ENHS')).toBe('zcli_aff_enhs.enhs.');
    expect(affMainFileName('ZCLI_AFF_ENHS', 'ENHS')).toBe('zcli_aff_enhs.enhs.json');
  });

  it('maps namespaced object names to the (ns)name filename token', () => {
    expect(affLocalPrefix('/UI2/CL_JSON', 'ENHS')).toBe('(ui2)cl_json.enhs.');
    expect(affMainFileName('/UI2/CL_JSON', 'ENHS')).toBe('(ui2)cl_json.enhs.json');
    expect(isAffBundleFileName('(ui2)cl_json.enhs.json', '/UI2/CL_JSON', 'ENHS')).toBe(true);
  });

  it('matches only files of the same object and type', () => {
    expect(isAffBundleFileName('zfoo.enhs.json', 'ZFOO', 'ENHS')).toBe(true);
    expect(isAffBundleFileName('ZFOO.ENHS.JSON', 'ZFOO', 'ENHS')).toBe(true);
    expect(isAffBundleFileName('zfoo.enho.json', 'ZFOO', 'ENHS')).toBe(false);
    expect(isAffBundleFileName('zbar.enhs.json', 'ZFOO', 'ENHS')).toBe(false);
  });

  it('rejects unsafe wire file names instead of writing outside --dir', () => {
    expect(safeAffOutputName('zfoo.enhs.json')).toBe('zfoo.enhs.json');
    expect(codeOf(() => safeAffOutputName('../zfoo.enhs.json'))).toBe('AFF_READ_FAILED');
    expect(codeOf(() => safeAffOutputName('/tmp/zfoo.enhs.json'))).toBe('AFF_READ_FAILED');
    expect(codeOf(() => safeAffOutputName('sub/zfoo.enhs.json'))).toBe('AFF_READ_FAILED');
  });
});

describe('AFF bundle discovery', () => {
  it('collects exactly the object/type prefix group, main document first', async () => {
    const dir = tmpDir();
    write(dir, 'zcli_aff_enhs.enhs.json', JSON.stringify(VALID_ENHS));
    // A companion content file of the same object (AFF allows sub-object /
    // content tokens after the object/type prefix).
    write(dir, 'zcli_aff_enhs.enhs.texts.en.properties', 'text');
    write(dir, 'zcli_aff_enhs.enhs.notes.txt', 'note');
    // Not part of the bundle:
    write(dir, 'zcli_aff_other.enhs.json', '{}');
    write(dir, 'zcli_aff_enhs.enho.json', '{}');
    write(dir, '.zcli_aff_enhs.enhs.json', '{}');
    fs.mkdirSync(path.join(dir, 'zcli_aff_enhs.enhs.dir'));

    const files = await discoverAffBundleFiles(dir, 'ZCLI_AFF_ENHS', 'ENHS');
    expect(files.map((file) => path.basename(file))).toEqual([
      'zcli_aff_enhs.enhs.json',
      'zcli_aff_enhs.enhs.notes.txt',
      'zcli_aff_enhs.enhs.texts.en.properties',
    ]);
    expect(hasAffMainFile(files, 'ZCLI_AFF_ENHS', 'ENHS')).toBe(true);
    expect(hasAffMainFile(files.slice(1), 'ZCLI_AFF_ENHS', 'ENHS')).toBe(false);
  });

  it('reads every file verbatim (basename + content, no reformatting)', async () => {
    const dir = tmpDir();
    const main = write(dir, 'zcli_aff_enhs.enhs.json', '{"formatVersion":"1"}\n');
    const companion = write(dir, 'zcli_aff_enhs.enhs.txt', 'raw\ntext');
    const bundle = await readAffBundle([main, companion]);
    expect(bundle).toEqual([
      { name: 'zcli_aff_enhs.enhs.json', content: '{"formatVersion":"1"}\n' },
      { name: 'zcli_aff_enhs.enhs.txt', content: 'raw\ntext' },
    ]);
  });
});

describe('AFF bundle validation', () => {
  it('accepts the canonical document for each of the six types', async () => {
    for (const type of AFF_BUNDLE_TYPES) {
      const mainName = affMainFileName('ZCLI_AFF_TEST', type);
      const result = await validateAffBundle(
        [{ name: mainName, content: JSON.stringify(VALID_DOCS[type]) }],
        'ZCLI_AFF_TEST',
        type,
        affSchemaFileFor(type),
      );
      expect(result, type).toBeUndefined();
    }
  });

  it('rejects a document that violates the vendored schema (exit-7 family)', async () => {
    const mainName = affMainFileName('ZCLI_AFF_TEST', 'ENHS');
    let caught: CliError | undefined;
    try {
      await validateAffBundle(
        [{ name: mainName, content: JSON.stringify({ formatVersion: '2' }) }],
        'ZCLI_AFF_TEST',
        'ENHS',
        'enhs-v1.json',
      );
    } catch (error: unknown) {
      caught = error as CliError;
    }
    expect(caught?.code).toBe('VALIDATION_ERROR');
    expect(categoryOf(caught!.code)).toBe('VALIDATION_ERROR');
    expect(String(caught?.message)).toMatch(/formatVersion|header|required/i);
  });

  it('requires the canonical main document in the bundle', async () => {
    let caught: CliError | undefined;
    try {
      await validateAffBundle(
        [
          { name: 'zcli_aff_test.enhs.notes.txt', content: 'x' },
          { name: 'zcli_aff_other.enhs.json', content: '{}' },
        ],
        'ZCLI_AFF_TEST',
        'ENHS',
        'enhs-v1.json',
      );
    } catch (error: unknown) {
      caught = error as CliError;
    }
    expect(caught?.code).toBe('AFF_FILE_INVALID');
  });

  it('rejects invalid JSON in any bundle file', async () => {
    const mainName = affMainFileName('ZCLI_AFF_TEST', 'ENHS');
    await expect(
      validateAffBundle(
        [
          { name: mainName, content: JSON.stringify(VALID_ENHS) },
          { name: 'zcli_aff_test.enhs.notes.json', content: '{oops' },
        ],
        'ZCLI_AFF_TEST',
        'ENHS',
        'enhs-v1.json',
      ),
    ).rejects.toMatchObject({ code: 'AFF_FILE_INVALID' });
  });

  it('rejects a --file that is not the object main document', () => {
    expect(() => assertAffMainFile('/tmp/zbar.enhs.json', 'ZCLI_AFF_TEST', 'ENHS')).toThrow(/zcli_aff_test\.enhs\.json/);
    expect(() => assertAffMainFile('/tmp/zcli_aff_test.enhs.json', 'ZCLI_AFF_TEST', 'ENHS')).not.toThrow();
  });

  it('readValidatedAffBundle returns the main file path for a valid group', async () => {
    const dir = tmpDir();
    const main = write(dir, 'zcli_aff_test.enhs.json', JSON.stringify(VALID_ENHS));
    write(dir, 'zcli_aff_test.enhs.txt', 'companion');
    const files = await discoverAffBundleFiles(dir, 'ZCLI_AFF_TEST', 'ENHS');
    const bundle = await readValidatedAffBundle(files, 'ZCLI_AFF_TEST', 'ENHS', 'enhs-v1.json');
    expect(bundle.mainFile).toBe(main);
    expect(bundle.files).toHaveLength(2);
  });

  it('applies --description to header.description before validation', async () => {
    const mainName = affMainFileName('ZCLI_AFF_TEST', 'ENHS');
    const patched = applyAffDescription(
      { name: mainName, content: JSON.stringify(VALID_ENHS) },
      'overridden description',
    );
    expect(JSON.parse(patched.content).header.description).toBe('overridden description');
    await expect(
      validateAffBundle([patched], 'ZCLI_AFF_TEST', 'ENHS', 'enhs-v1.json'),
    ).resolves.toBeUndefined();
  });
});

describe('AFF registry / routing / catalog wiring', () => {
  it('registers the six AFF types with a per-type transport channel', () => {
    expect([...AFF_BUNDLE_TYPES]).toEqual(['APLO', 'CHDO', 'EVTB', 'SMBC', 'ENHO', 'ENHS']);
    for (const type of AFF_BUNDLE_TYPES) {
      expect(requiresFileFor(type)).toBe(true);
      expect(affSchemaFileFor(type)).toBe(`${type.toLowerCase()}-v1.json`);
      expect(isAffBundleType(type)).toBe(true);
      expect(affBundleTypeFor(type.toLowerCase())).toBe(type);
    }
    // APLO/CHDO/EVTB/SMBC: source/main is the AFF document over ADT blueSource.
    for (const type of ['APLO', 'CHDO', 'EVTB', 'SMBC'] as const) {
      expect(sourceFor(type), type).toBe('ADT');
      expect(affChannelFor(type), type).toBe('adt-blue');
      // TADIR-OBJ_NAME is CHAR 40; the reference release rejects CHDO names
      // above 16 ("syntax cannot be used for object name") and addresses APLO
      // as C(20).
      expect(maxNameLengthFor(type), type).toBe(
        type === 'CHDO' ? 16 : type === 'APLO' ? 20 : 40,
      );
    }
    // ENHO/ENHS: read-only through the bundled ICF /aff endpoint.
    for (const type of ['ENHO', 'ENHS'] as const) {
      expect(sourceFor(type), type).toBe('ICF');
      expect(affChannelFor(type), type).toBe('icf');
      expect(maxNameLengthFor(type), type).toBe(40);
      expect(createUnsupportedReasonFor(type), type).toMatch(/read-only/i);
      expect(pushUnsupportedReasonFor(type), type).toMatch(/read-only/i);
      expect(deleteUnsupportedReasonFor(type), type).toMatch(/cannot be deleted|read-only/i);
    }
    expect(affChannelFor('CLAS')).toBeUndefined();
    expect(isAffBundleType('CLAS')).toBe(false);
    expect(affBundleTypeFor(undefined)).toBeUndefined();
  });

  it('routes create/pull/push through the type channel (ENHO/ENHS pull-only)', () => {
    for (const type of ['APLO', 'CHDO', 'EVTB', 'SMBC'] as const) {
      const row = TYPE_ROUTES[type]!;
      expect(row.create?.channel, `${type}.create`).toBe('adt');
      expect(row.pull?.channel, `${type}.pull`).toBe('adt');
      expect(row.push?.channel, `${type}.push`).toBe('adt');
      expect(row.push?.kind, `${type}.push`).toBe('aff-json');
    }
    for (const type of ['ENHO', 'ENHS'] as const) {
      const row = TYPE_ROUTES[type]!;
      expect(row.create, `${type}.create`).toBeUndefined();
      expect(row.pull?.channel, `${type}.pull`).toBe('icf');
      expect(row.push, `${type}.push`).toBeUndefined();
    }
  });

  it('exposes the six types in `abap types` with TADIR code, channel + AFF schema', () => {
    const rows = typeCatalog();
    for (const type of AFF_BUNDLE_TYPES) {
      const row = rows.find((entry) => entry.cliType === type);
      expect(row, type).toBeDefined();
      expect(row).toMatchObject({
        cliType: type,
        tadirObject: type,
        channel: type === 'ENHO' || type === 'ENHS' ? 'ICF' : 'ADT',
        affSchema: `${type.toLowerCase()}-v1.json`,
        pgmid: 'R3TR',
      });
    }
  });
});

describe('AFF transport rule', () => {
  const object = { type: 'ENHS', name: 'ZCLI_AFF_TEST' };

  it('treats $-prefixed packages as transport-free, dropping a stray --tr', () => {
    expect(affTransportFor({ ...object, packageName: '$TMP' }, undefined, 'create')).toBeUndefined();
    expect(affTransportFor({ ...object, packageName: '$TMP' }, 'NDK900123', 'update')).toBeUndefined();
    expect(affTransportFor({ ...object, packageName: '$CRW' }, 'X', 'delete')).toBeUndefined();
  });

  it('requires --tr for transportable packages (exit-7 family)', () => {
    let caught: CliError | undefined;
    try {
      affTransportFor({ ...object, packageName: 'ZPKG' }, undefined, 'create');
    } catch (error: unknown) {
      caught = error as CliError;
    }
    expect(caught?.code).toBe('AFF_TRANSPORT_REQUIRED');
    expect(categoryOf(caught!.code)).toBe('VALIDATION_ERROR');
    expect(affTransportFor({ ...object, packageName: 'ZPKG' }, 'ndk900123', 'create')).toBe('NDK900123');
  });
});

describe('AFF endpoint error codes', () => {
  it('maps every endpoint code to the documented exit-code category', () => {
    expect(categoryOf('AFF_NOT_FOUND')).toBe('NOT_FOUND');
    expect(categoryOf('AFF_SERVICE_INVALID')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_UNSUPPORTED')).toBe('SAP_ERROR');
    expect(categoryOf('AFF_WRITE_UNSUPPORTED')).toBe('SAP_ERROR');
    expect(categoryOf('AFF_DELETE_UNSUPPORTED')).toBe('SAP_ERROR');
    expect(categoryOf('AFF_TYPE_INVALID')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_NAME_INVALID')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_READ_FAILED')).toBe('SAP_ERROR');
    expect(categoryOf('AFF_ALREADY_EXISTS')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_PACKAGE_REQUIRED')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_FILE_INVALID')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_TRANSPORT_REQUIRED')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_LOCKED')).toBe('LOCKED');
    expect(categoryOf('AFF_WRITE_FAILED')).toBe('SAP_ERROR');
    expect(categoryOf('AFF_ACTIVATION_FAILED')).toBe('VALIDATION_ERROR');
    expect(categoryOf('AFF_DELETE_FAILED')).toBe('SAP_ERROR');
  });
});

describe('AFF push target dedup', () => {
  it('collapses multiple files of the same object to the first target', () => {
    const dir = tmpDir();
    const a = path.join(dir, 'zcli_aff_test.enhs.json');
    const b = path.join(dir, 'zcli_aff_test.enhs.txt');
    expect(deduplicateAffBundleTargets([a, b])).toEqual([a]);
  });

  it('keeps files of different objects/directories and non-AFF files', () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    const a = path.join(dir1, 'zcli_aff_test.enhs.json');
    const other = path.join(dir1, 'zcli_aff_other.enhs.json');
    const sameObjectOtherDir = path.join(dir2, 'zcli_aff_test.enhs.json');
    const source = path.join(dir1, 'zcl_demo.clas.abap');
    const files = [a, other, sameObjectOtherDir, source];
    expect(deduplicateAffBundleTargets(files)).toEqual(files);
  });

  it('passes unparseable filenames through unchanged', () => {
    expect(deduplicateAffBundleTargets(['not-a-file'])).toEqual(['not-a-file']);
  });
});

describe('AFF bundle file type', () => {
  it('accepts UTF-8 text content as wire files (no base64)', () => {
    const files: AffBundleFile[] = [{ name: 'zcli_aff_test.enhs.json', content: '{"formatVersion":"1"}' }];
    expect(files[0]!.content).toContain('formatVersion');
  });
});
