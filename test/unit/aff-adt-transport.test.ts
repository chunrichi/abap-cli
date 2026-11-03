/**
 * ADT blueSource AFF transport: wire helpers + operation semantics.
 *
 * APLO / CHDO / EVTB / SMBC are plain ADT blueSource resources whose
 * `source/main` is the official AFF JSON. These tests pin:
 *   - per-type collections/object types and lower-cased object URLs;
 *   - the blueSource metadata XML builder/parser (attributes, packageRef);
 *   - create = POST collection + locked write, push = metadata read + locked
 *     write, delete = direct DELETE (no lock in between);
 *   - activation failures surface SAP's messages as ACTIVATION_FAILED/exit 7;
 *   - endpoint errors map to the CLI contract (404 → OBJECT_NOT_FOUND,
 *     409 → AFF_ALREADY_EXISTS, 400 → VALIDATION_ERROR with the SAP message);
 *   - multi-file local bundles are rejected (single-document channel).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ADT_BLUE_SOURCE_INFO,
  adtBlueSourceFileName,
  adtBlueSourceObjectUrl,
  adtBlueSourceSourceUrl,
  buildAdtBlueSourceBody,
  isAdtBlueSourceType,
  mapAdtBlueSourceError,
  parseAdtBlueSourceMeta,
} from '../../src/abap_cli/clients/adt-blue-source.js';
import {
  createAdtAffObject,
  deleteAdtAffObject,
  pullAdtAffObject,
  pushAdtAffObject,
  readAdtAffMeta,
  requireSingleAffDocument,
} from '../../src/abap_cli/formats/aff/adt-transport.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { categoryOf } from '../../src/abap_cli/output/error-codes.js';
import type { AdtClientWrapper } from '../../src/abap_cli/clients/adt-client.js';

const META_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core"' +
  ' adtcore:name="ZCLI_MOCK_APLO" adtcore:type="APLO/TYP" adtcore:description="mock AFF object"' +
  ' adtcore:language="EN" adtcore:masterLanguage="DE">' +
  '<adtcore:packageRef adtcore:name="$TMP"/>' +
  '</blue:blueSource>';

const SOURCE = JSON.stringify({
  formatVersion: '1',
  header: { description: 'mock AFF object', originalLanguage: 'DE' },
  subobjects: [],
});

/** Fake AdtClientWrapper: records calls and lets each operation fail on demand. */
function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const client = {
    createBlueSourceObject: vi.fn(async () => {
      calls.push('create');
    }),
    writeBlueSourceSource: vi.fn(async () => {
      calls.push('write');
    }),
    getBlueSourceObject: vi.fn(async () => {
      calls.push('meta');
      return META_XML;
    }),
    getBlueSourceSource: vi.fn(async () => {
      calls.push('source');
      return SOURCE;
    }),
    deleteBlueSourceObject: vi.fn(async () => {
      calls.push('delete');
    }),
    ...overrides,
  };
  return { client: client as unknown as AdtClientWrapper, calls, raw: client };
}

function sapError(httpStatus: number, message: string): CliError {
  return new CliError('SAP_ERROR', message, {
    details: { httpStatus, sapErrorBody: `<message>${message}</message>` },
  });
}

describe('ADT blueSource addressing', () => {
  it('maps each AFF type to its ADT collection and object type', () => {
    expect(ADT_BLUE_SOURCE_INFO.APLO).toMatchObject({
      collection: '/sap/bc/adt/applicationlog/objects',
      objtype: 'APLO/TYP',
      jsonSuffix: '.aplo.json',
    });
    expect(ADT_BLUE_SOURCE_INFO.CHDO).toMatchObject({
      collection: '/sap/bc/adt/changedocuments/objects',
      objtype: 'CHDO/HD',
    });
    expect(ADT_BLUE_SOURCE_INFO.EVTB).toMatchObject({
      collection: '/sap/bc/adt/businessservices/evtbevb',
      objtype: 'EVTB/EB',
    });
    expect(ADT_BLUE_SOURCE_INFO.SMBC).toMatchObject({
      collection: '/sap/bc/adt/bct/smbctyp',
      objtype: 'SMBC/TYP',
    });
    // Real-system limit: CHDO rejects 17-character names.
    expect(ADT_BLUE_SOURCE_INFO.CHDO.maxNameLength).toBe(16);
    for (const type of ['APLO', 'EVTB', 'SMBC'] as const) {
      // APLO is addressed as C(20) and CHDO rejects >16 on the reference
      // release; EVTB / SMBC use the TADIR width.
      expect(ADT_BLUE_SOURCE_INFO[type].maxNameLength).toBe(
        type === 'APLO' ? 20 : type === 'CHDO' ? 16 : 40,
      );
    }
    expect(isAdtBlueSourceType('APLO')).toBe(true);
    expect(isAdtBlueSourceType('ENHS')).toBe(false);
  });

  it('builds lower-cased, encoded object URLs and source URLs', () => {
    expect(adtBlueSourceObjectUrl('APLO', 'ZCLI_MOCK_APLO')).toBe(
      '/sap/bc/adt/applicationlog/objects/zcli_mock_aplo',
    );
    expect(adtBlueSourceSourceUrl('CHDO', 'ZCLI_MOCK_CHDO')).toBe(
      '/sap/bc/adt/changedocuments/objects/zcli_mock_chdo/source/main',
    );
    // Namespaced objects are addressed by their real (lower-cased) ADT name;
    // only the *local AFF file name* uses the `(ns)name` token.
    expect(adtBlueSourceObjectUrl('CHDO', '/ATL/FORECHIST')).toBe(
      `/sap/bc/adt/changedocuments/objects/${encodeURIComponent('/atl/forechist')}`,
    );
  });

  it('derives the local AFF filename from the object name/type', () => {
    expect(adtBlueSourceFileName('ZCLI_MOCK_APLO', 'APLO')).toBe('zcli_mock_aplo.aplo.json');
    expect(adtBlueSourceFileName('/ATL/FORECHIST', 'CHDO')).toBe('(atl)forechist.chdo.json');
  });
});

describe('ADT blueSource metadata body', () => {
  it('builds the create body with the type-specific adtcore attributes', () => {
    const body = buildAdtBlueSourceBody('EVTB', 'ZCLI_MOCK_EVTB', {
      packageName: '$TMP',
      description: 'mock "event" & binding',
      language: 'en',
      originalLanguage: 'de',
    });
    expect(body).toContain('<blue:blueSource');
    expect(body).toContain('adtcore:type="EVTB/EB"');
    expect(body).toContain('adtcore:name="ZCLI_MOCK_EVTB"');
    expect(body).toContain('adtcore:description="mock &quot;event&quot; &amp; binding"');
    expect(body).toContain('adtcore:language="EN"');
    expect(body).toContain('adtcore:masterLanguage="DE"');
    expect(body).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
  });

  it('omits the package reference for metadata updates', () => {
    const body = buildAdtBlueSourceBody('APLO', 'ZCLI_MOCK_APLO', {
      description: 'updated description',
      language: 'EN',
    });
    expect(body).not.toContain('packageRef');
    expect(body).toContain('adtcore:description="updated description"');
  });

  it('parses description, master language and package from metadata', () => {
    expect(parseAdtBlueSourceMeta('APLO', META_XML)).toEqual({
      description: 'mock AFF object',
      originalLanguage: 'de',
      packageName: '$TMP',
    });
  });
});

describe('ADT blueSource operation flow', () => {
  it('creates then writes (locked) the AFF document', async () => {
    const { client, calls } = fakeClient();
    await createAdtAffObject(client, 'APLO', {
      objectName: 'ZCLI_MOCK_APLO',
      packageName: '$TMP',
      description: 'mock AFF object',
      originalLanguage: 'DE',
      source: SOURCE,
    });
    expect(calls).toEqual(['create', 'write']);
    expect((client as unknown as { createBlueSourceObject: ReturnType<typeof vi.fn> }).createBlueSourceObject)
      .toHaveBeenCalledWith('APLO', 'ZCLI_MOCK_APLO', expect.objectContaining({ packageName: '$TMP' }));
  });

  it('pulls the AFF document verbatim with its metadata', async () => {
    const { client, calls } = fakeClient();
    const result = await pullAdtAffObject(client, 'CHDO', 'ZCLI_MOCK_CHDO');
    expect(calls).toEqual(['source', 'meta']);
    expect(result.source).toBe(SOURCE);
    expect(result.meta).toMatchObject({ originalLanguage: 'de', packageName: '$TMP' });
  });

  it('updates an existing object only after reading its metadata', async () => {
    const { client, calls } = fakeClient();
    const meta = await readAdtAffMeta(client, 'EVTB', 'ZCLI_MOCK_EVTB', 'update');
    expect(meta.packageName).toBe('$TMP');
    await pushAdtAffObject(client, 'EVTB', 'ZCLI_MOCK_EVTB', SOURCE, { description: 'd', masterLanguage: 'EN' });
    expect(calls).toEqual(['meta', 'write']);
    expect((client as unknown as { writeBlueSourceSource: ReturnType<typeof vi.fn> }).writeBlueSourceSource)
      .toHaveBeenCalledWith(
        'EVTB',
        'ZCLI_MOCK_EVTB',
        SOURCE,
        expect.objectContaining({ description: 'd', masterLanguage: 'EN' }),
      );
  });

  it('deletes without a lock (ADT DELETE on these resources needs none)', async () => {
    const { client, calls } = fakeClient();
    const result = await deleteAdtAffObject(client, 'SMBC', 'ZCLI_MOCK_SMBC', 'NDK900123');
    expect(calls).toEqual(['delete']);
    expect(result.lockReleased).toBe(true);
    expect((client as unknown as { deleteBlueSourceObject: ReturnType<typeof vi.fn> }).deleteBlueSourceObject)
      .toHaveBeenCalledWith('SMBC', 'ZCLI_MOCK_SMBC', 'NDK900123');
  });

  it('rejects multi-file local bundles (single-document ADT channel)', () => {
    expect(() =>
      requireSingleAffDocument(
        [
          { name: 'zfoo.aplo.json', content: '{}' },
          { name: 'zfoo.aplo.notes.txt', content: 'x' },
        ],
        'APLO',
      ),
    ).toThrow(/single|one AFF document|exactly one/i);
    try {
      requireSingleAffDocument([{ name: 'a', content: '' }, { name: 'b', content: '' }], 'APLO');
    } catch (error: unknown) {
      expect((error as CliError).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('ADT blueSource error mapping', () => {
  it('maps 404 on read/update/delete to OBJECT_NOT_FOUND (exit 8)', () => {
    for (const action of ['read', 'update', 'delete'] as const) {
      try {
        mapAdtBlueSourceError('APLO', 'ZCLI_MOCK_APLO', action, sapError(404, 'not found'));
      } catch (error: unknown) {
        const err = error as CliError;
        expect(err.code).toBe('OBJECT_NOT_FOUND');
        expect(categoryOf(err.code)).toBe('NOT_FOUND');
      }
    }
  });

  it('maps 404 on create to AFF_UNSUPPORTED (release without the ADT resource)', () => {
    try {
      mapAdtBlueSourceError('APLO', 'ZCLI_MOCK_APLO', 'create', sapError(404, 'not found'));
    } catch (error: unknown) {
      const err = error as CliError;
      expect(err.code).toBe('AFF_UNSUPPORTED');
      expect(categoryOf(err.code)).toBe('SAP_ERROR');
    }
  });

  it('maps 409 to AFF_ALREADY_EXISTS with a push pointer', () => {
    try {
      mapAdtBlueSourceError('CHDO', 'ZCLI_MOCK_CHDO', 'create', sapError(409, 'already exists'));
    } catch (error: unknown) {
      const err = error as CliError;
      expect(err.code).toBe('AFF_ALREADY_EXISTS');
      expect(categoryOf(err.code)).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(err.nextSteps)).toMatch(/abap push/);
    }
  });

  it('maps 400 to VALIDATION_ERROR and keeps SAP message + body', () => {
    try {
      mapAdtBlueSourceError('EVTB', 'ZCLI_MOCK_EVTB', 'update', sapError(400, 'Event already exists'));
    } catch (error: unknown) {
      const err = error as CliError;
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toContain('Event already exists');
      expect(err.details?.sapMessage).toBe('Event already exists');
      expect(String(err.details?.sapErrorBody)).toContain('Event already exists');
    }
  });

  it('keeps activation failures as ACTIVATION_FAILED (VALIDATION_ERROR/exit 7) with SAP messages', async () => {
    const activationError = new CliError('ACTIVATION_FAILED', 'Activation failed for X: two duplicate events', {
      details: {
        messages: [
          { type: 'E', text: 'Event already exists' },
          { type: 'E', text: 'Second problem' },
        ],
      },
    });
    const { client } = fakeClient({
      writeBlueSourceSource: vi.fn(async () => {
        throw activationError;
      }),
    });
    await expect(
      pushAdtAffObject(client, 'EVTB', 'ZCLI_MOCK_EVTB', SOURCE, {}),
    ).rejects.toMatchObject({
      code: 'ACTIVATION_FAILED',
      details: { messages: expect.any(Array) },
    });
    try {
      await pushAdtAffObject(client, 'EVTB', 'ZCLI_MOCK_EVTB', SOURCE, {});
    } catch (error: unknown) {
      const err = error as CliError;
      expect(categoryOf(err.code)).toBe('VALIDATION_ERROR');
      expect(err.message).toContain('EVTB ZCLI_MOCK_EVTB');
      expect(err.message).toContain('two duplicate events');
      expect((err.details?.messages as unknown[]).length).toBe(2);
    }
  });
});
