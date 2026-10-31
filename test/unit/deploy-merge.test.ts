import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  loadDeployManifest,
  mergeReleaseSources,
  orderDevObjects,
  parseDeployManifest,
  type DeployManifest,
  type DevClassSource,
} from '../../src/abap_cli/flows/edit/deploy-merge.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* -------------------------------------------------------------------------- */
/* Helpers */
/* -------------------------------------------------------------------------- */

function captureError(run: () => unknown): CliError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected the call to throw a CliError');
}

function expectErrorCode(run: () => unknown, code: 'DEPLOY_MANIFEST_INVALID' | 'DEPLOY_MERGE_FAILED'): CliError {
  const error = captureError(run);
  expect(error.code).toBe(code);
  return error;
}

async function captureRejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected the promise to reject with a CliError');
}

/**
 * Build one dev-form AFF main: global class definition block followed by an
 * optional implementation block (both in the same file, as the dev form does).
 */
function classMain(options: {
  global: string;
  definitionBody: string;
  implementationBody?: string;
  header?: string;
}): string {
  const lower = options.global.toLowerCase();
  const header = options.header ?? `CLASS ${lower} DEFINITION PUBLIC FINAL CREATE PUBLIC.`;
  let main = `${header}\n${options.definitionBody.trimEnd()}\nENDCLASS.\n`;
  if (options.implementationBody !== undefined) {
    main += `\nCLASS ${lower} IMPLEMENTATION.\n${options.implementationBody.trimEnd()}\nENDCLASS.\n`;
  }
  return main;
}

function expectSingleTrailingNewline(text: string): void {
  expect(text.endsWith('\n')).toBe(true);
  expect(text.endsWith('\n\n')).toBe(false);
}

/* -------------------------------------------------------------------------- */
/* Manifest parsing / validation */
/* -------------------------------------------------------------------------- */

const VALID_MANIFEST: DeployManifest = {
  handler: 'ZCL_MY_HANDLER',
  merged: [
    { global: 'ZCL_MY_TYPES', local: 'lcl_types' },
    { global: 'ZCL_MY_RESPONSE', local: 'lcl_response' },
  ],
  standalone: ['ZCL_MY_SETUP'],
};

const VALID_MANIFEST_JSON = JSON.stringify(VALID_MANIFEST);

function mutatedManifestJson(mutate: (raw: Record<string, unknown>) => void): string {
  const raw = JSON.parse(VALID_MANIFEST_JSON) as Record<string, unknown>;
  mutate(raw);
  return JSON.stringify(raw);
}

describe('parseDeployManifest', () => {
  it('parses a valid manifest', () => {
    expect(parseDeployManifest(VALID_MANIFEST_JSON)).toEqual(VALID_MANIFEST);
  });

  it('accepts a UTF-8 BOM in front of the JSON', () => {
    expect(parseDeployManifest(`\uFEFF${VALID_MANIFEST_JSON}`)).toEqual(VALID_MANIFEST);
  });

  it('reports malformed JSON with the source path and next steps', () => {
    const error = expectErrorCode(
      () => parseDeployManifest('{ "handler": ', '/pkg/abap/deploy.json'),
      'DEPLOY_MANIFEST_INVALID',
    );
    expect(error.details?.source).toBe('/pkg/abap/deploy.json');
    expect(error.details?.reason).toBeTruthy();
    expect((error.nextSteps ?? []).join('\n')).toContain('abap/deploy.json');
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"deploy.json"'],
    ['a number', '42'],
  ])('rejects a manifest that is %s', (_label, raw) => {
    const error = expectErrorCode(() => parseDeployManifest(raw), 'DEPLOY_MANIFEST_INVALID');
    expect(error.details?.field).toBe('$');
  });

  it.each<{
    label: string;
    mutate: (raw: Record<string, unknown>) => void;
    field?: string;
    className?: string;
  }>([
    {
      label: 'a missing handler',
      mutate: (raw) => delete raw.handler,
      field: 'handler',
    },
    {
      label: 'an empty handler',
      mutate: (raw) => (raw.handler = ''),
      field: 'handler',
    },
    {
      label: 'a lowercase handler',
      mutate: (raw) => (raw.handler = 'zcl_my_handler'),
      field: 'handler',
    },
    {
      label: 'a handler with an illegal character',
      mutate: (raw) => (raw.handler = 'ZCL-MY-HANDLER'),
      field: 'handler',
    },
    {
      label: 'an over-long handler',
      mutate: (raw) => (raw.handler = `Z${'A'.repeat(30)}`),
      field: 'handler',
    },
    {
      label: 'a non-array merged',
      mutate: (raw) => (raw.merged = {}),
      field: 'merged',
    },
    {
      label: 'a non-array standalone',
      mutate: (raw) => (raw.standalone = 'ZCL_MY_SETUP'),
      field: 'standalone',
    },
    {
      label: 'a non-object merged entry',
      mutate: (raw) => (raw.merged = ['ZCL_MY_TYPES']),
      field: 'merged[0]',
    },
    {
      label: 'a merged entry without global',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0] = { local: 'lcl_types' }),
      field: 'merged[0].global',
    },
    {
      label: 'a merged entry without local',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0] = { global: 'ZCL_MY_TYPES' }),
      field: 'merged[0].local',
    },
    {
      label: 'a lowercase merged global',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0]!.global = 'zcl_my_types'),
      field: 'merged[0].global',
    },
    {
      label: 'an uppercase merged local',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0]!.local = 'LCL_TYPES'),
      field: 'merged[0].local',
    },
    {
      label: 'a merged local without the lcl_ prefix',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0]!.local = 'types'),
      field: 'merged[0].local',
    },
    {
      label: 'an over-long merged local',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0]!.local = `lcl_${'a'.repeat(27)}`),
      field: 'merged[0].local',
    },
    {
      label: 'an over-long merged global',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0]!.global = `ZCL_${'A'.repeat(27)}`),
      field: 'merged[0].global',
    },
    {
      label: 'a duplicated merged global',
      mutate: (raw) => {
        const merged = raw.merged as Record<string, unknown>[];
        merged[1]!.global = merged[0]!.global;
      },
      field: 'merged[1].global',
      className: 'ZCL_MY_TYPES',
    },
    {
      label: 'a duplicated merged local',
      mutate: (raw) => {
        const merged = raw.merged as Record<string, unknown>[];
        merged[1]!.local = merged[0]!.local;
      },
      field: 'merged[1].local',
      className: 'lcl_types',
    },
    {
      label: 'the handler repeated in merged',
      mutate: (raw) => ((raw.merged as Record<string, unknown>[])[0]!.global = 'ZCL_MY_HANDLER'),
      field: 'handler',
      className: 'ZCL_MY_HANDLER',
    },
    {
      label: 'the handler repeated in standalone',
      mutate: (raw) => (raw.standalone = ['ZCL_MY_HANDLER']),
      field: 'handler',
      className: 'ZCL_MY_HANDLER',
    },
    {
      label: 'a standalone class marked merged as well',
      mutate: (raw) => (raw.standalone = ['ZCL_MY_TYPES']),
      field: 'standalone[0]',
      className: 'ZCL_MY_TYPES',
    },
    {
      label: 'a duplicated standalone class',
      mutate: (raw) => (raw.standalone = ['ZCL_MY_SETUP', 'ZCL_MY_SETUP']),
      field: 'standalone[1]',
      className: 'ZCL_MY_SETUP',
    },
    {
      label: 'a non-string standalone entry',
      mutate: (raw) => (raw.standalone = [42]),
      field: 'standalone[0]',
    },
    {
      label: 'an invalid standalone name',
      mutate: (raw) => (raw.standalone = ['zcl_my_setup']),
      field: 'standalone[0]',
    },
  ])('rejects $label', ({ mutate, field, className }) => {
    const error = expectErrorCode(() => parseDeployManifest(mutatedManifestJson(mutate)), 'DEPLOY_MANIFEST_INVALID');
    if (field !== undefined) expect(error.details?.field).toBe(field);
    if (className !== undefined) expect(error.details?.class).toBe(className);
  });

  it('accepts an empty merged / standalone manifest (handler-only release)', () => {
    expect(parseDeployManifest(JSON.stringify({ handler: 'ZCL_MY_HANDLER', merged: [], standalone: [] }))).toEqual({
      handler: 'ZCL_MY_HANDLER',
      merged: [],
      standalone: [],
    });
  });
});

describe('loadDeployManifest', () => {
  const fixtureRoot = path.join(repoRoot, 'test/fixtures/deploy-merge/load-root');

  it('reads <sourceDir>/../deploy.json', async () => {
    const manifest = await loadDeployManifest(path.join(fixtureRoot, 'src'));
    expect(manifest).toEqual({
      handler: 'ZCL_MY_HANDLER',
      merged: [{ global: 'ZCL_MY_TYPES', local: 'lcl_types' }],
      standalone: ['ZCL_MY_SETUP'],
    });
  });

  it('rejects a missing manifest with an actionable DEPLOY_MANIFEST_INVALID error', async () => {
    const missingSourceDir = path.join(fixtureRoot, 'missing-project', 'src');
    const error = await captureRejection(loadDeployManifest(missingSourceDir));
    expect(error.code).toBe('DEPLOY_MANIFEST_INVALID');
    expect(error.details?.source).toBe(path.join(fixtureRoot, 'missing-project', 'deploy.json'));
    expect(error.message).toContain('deploy manifest not found');
    expect((error.nextSteps ?? []).join('\n')).toContain('abap/deploy.json');
  });
});

/* -------------------------------------------------------------------------- */
/* Release merge — normal path */
/* -------------------------------------------------------------------------- */

const MERGE_MANIFEST: DeployManifest = {
  handler: 'ZCL_MY_HANDLER',
  merged: [
    // Scrambled on purpose: dependency order is lcl_types -> lcl_response -> lcl_http.
    { global: 'ZCL_MY_RESPONSE', local: 'lcl_response' },
    { global: 'ZCL_MY_HTTP', local: 'lcl_http' },
    { global: 'ZCL_MY_TYPES', local: 'lcl_types' },
  ],
  standalone: ['ZCL_MY_SETUP'],
};

const MERGE_HANDLER_MAIN = [
  'CLASS zcl_my_handler DEFINITION PUBLIC CREATE PUBLIC.',
  '  PUBLIC SECTION.',
  '    INTERFACES if_http_extension.',
  'ENDCLASS.',
  '',
  'CLASS zcl_my_handler IMPLEMENTATION.',
  '  METHOD if_http_extension~handle_request.',
  '    zcl_my_response=>handle_root( server = server ).',
  '  ENDMETHOD.',
  'ENDCLASS.',
  '',
].join('\n');

const MERGE_TYPES_MAIN = classMain({
  global: 'ZCL_MY_TYPES',
  definitionBody: [
    '  PUBLIC SECTION.',
    '    TYPES: BEGIN OF ty_root,',
    '             status TYPE string,',
    '           END OF ty_root.',
  ].join('\n'),
});

const MERGE_RESPONSE_MAIN = `*"* response helper: shared JSON response builders.\n${classMain({
  global: 'ZCL_MY_RESPONSE',
  definitionBody: [
    '  PUBLIC SECTION.',
    '    CLASS-METHODS handle_root',
    '      IMPORTING io_server TYPE REF TO if_http_server',
    '      RETURNING VALUE(rs_root) TYPE zcl_my_types=>ty_root.',
  ].join('\n'),
  implementationBody: [
    '  METHOD handle_root.',
    "    rs_root = VALUE #( status = 'success' ).",
    '  ENDMETHOD.',
  ].join('\n'),
})}`;

const MERGE_HTTP_MAIN = classMain({
  global: 'ZCL_MY_HTTP',
  // Multi-line global class header: every attribute line must be consumed.
  header: ['CLASS zcl_my_http DEFINITION', '  PUBLIC', '  FINAL', '  CREATE PUBLIC.'].join('\n'),
  definitionBody: [
    '  PUBLIC SECTION.',
    '    CLASS-METHODS dispatch',
    '      IMPORTING io_response TYPE REF TO zcl_my_response.',
  ].join('\n'),
  implementationBody: [
    '  METHOD dispatch.',
    '    " delegates to the response helper',
    '    io_response->handle_root( io_server = io_server ).',
    '  ENDMETHOD.',
  ].join('\n'),
});

function mergeClassesFixture(): Map<string, DevClassSource> {
  return new Map<string, DevClassSource>([
    ['ZCL_MY_HANDLER', { main: MERGE_HANDLER_MAIN }],
    ['ZCL_MY_RESPONSE', { main: MERGE_RESPONSE_MAIN }],
    ['ZCL_MY_HTTP', { main: MERGE_HTTP_MAIN }],
    ['ZCL_MY_TYPES', { main: MERGE_TYPES_MAIN }],
  ]);
}

const EXPECTED_HANDLER_MAIN = [
  'CLASS zcl_my_handler DEFINITION PUBLIC CREATE PUBLIC.',
  '  PUBLIC SECTION.',
  '    INTERFACES if_http_extension.',
  'ENDCLASS.',
  '',
  'CLASS zcl_my_handler IMPLEMENTATION.',
  '  METHOD if_http_extension~handle_request.',
  '    lcl_response=>handle_root( server = server ).',
  '  ENDMETHOD.',
  'ENDCLASS.',
  '',
].join('\n');

const EXPECTED_TYPES_DEFINITION = [
  'CLASS lcl_types DEFINITION.',
  '  PUBLIC SECTION.',
  '    TYPES: BEGIN OF ty_root,',
  '             status TYPE string,',
  '           END OF ty_root.',
  'ENDCLASS.',
].join('\n');

const EXPECTED_RESPONSE_DEFINITION = [
  '*"* response helper: shared JSON response builders.',
  'CLASS lcl_response DEFINITION.',
  '  PUBLIC SECTION.',
  '    CLASS-METHODS handle_root',
  '      IMPORTING io_server TYPE REF TO if_http_server',
  '      RETURNING VALUE(rs_root) TYPE lcl_types=>ty_root.',
  'ENDCLASS.',
].join('\n');

const EXPECTED_HTTP_DEFINITION = [
  'CLASS lcl_http DEFINITION.',
  '  PUBLIC SECTION.',
  '    CLASS-METHODS dispatch',
  '      IMPORTING io_response TYPE REF TO lcl_response.',
  'ENDCLASS.',
].join('\n');

const EXPECTED_DEFINITIONS = [EXPECTED_TYPES_DEFINITION, EXPECTED_RESPONSE_DEFINITION, EXPECTED_HTTP_DEFINITION].join(
  '\n\n',
).concat('\n');

const EXPECTED_RESPONSE_IMPLEMENTATION = [
  'CLASS lcl_response IMPLEMENTATION.',
  '  METHOD handle_root.',
  "    rs_root = VALUE #( status = 'success' ).",
  '  ENDMETHOD.',
  'ENDCLASS.',
].join('\n');

const EXPECTED_HTTP_IMPLEMENTATION = [
  'CLASS lcl_http IMPLEMENTATION.',
  '  METHOD dispatch.',
  '    " delegates to the response helper',
  '    io_response->handle_root( io_server = io_server ).',
  '  ENDMETHOD.',
  'ENDCLASS.',
].join('\n');

const EXPECTED_IMPLEMENTATIONS = [EXPECTED_RESPONSE_IMPLEMENTATION, EXPECTED_HTTP_IMPLEMENTATION].join('\n\n').concat('\n');

describe('mergeReleaseSources — release form', () => {
  it('merges the dev classes into one handler with deterministic layout', () => {
    const result = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });

    expect(result.orderedLocals).toEqual(['lcl_types', 'lcl_response', 'lcl_http']);
    expect(result.handler.main).toBe(EXPECTED_HANDLER_MAIN);
    expect(result.handler.definitions).toBe(EXPECTED_DEFINITIONS);
    expect(result.handler.implementations).toBe(EXPECTED_IMPLEMENTATIONS);
  });

  it('emits exactly one trailing newline for every generated part', () => {
    const result = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    expectSingleTrailingNewline(result.handler.main);
    expectSingleTrailingNewline(result.handler.definitions);
    expectSingleTrailingNewline(result.handler.implementations);
  });

  it('skips the implementation include for a definition-only class', () => {
    const result = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    expect(result.orderedLocals).toContain('lcl_types');
    expect(result.handler.implementations).not.toContain('lcl_types');
    expect(result.handler.implementations).not.toContain('CLASS-METHODS');
  });

  it('drops the global class header attributes and keeps leading comments', () => {
    const result = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    expect(result.handler.definitions).toContain('CLASS lcl_http DEFINITION.\n');
    expect(result.handler.definitions).not.toMatch(/CLASS\s+lcl_\w+\s+DEFINITION\s+(PUBLIC|FINAL|CREATE)/i);
    expect(result.handler.definitions).toContain('*"* response helper: shared JSON response builders.');
  });

  it('renames every helper reference and leaves the handler class untouched', () => {
    const result = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    expect(result.handler.main).toContain('CLASS zcl_my_handler DEFINITION PUBLIC CREATE PUBLIC.');
    expect(result.handler.main).not.toMatch(/ZCL_MY_(RESPONSE|HTTP|TYPES)/i);
    expect(result.handler.definitions).not.toMatch(/ZCL_MY_(RESPONSE|HTTP|TYPES)/i);
    expect(result.handler.implementations).not.toMatch(/ZCL_MY_(RESPONSE|HTTP|TYPES)/i);
  });

  it('is deterministic and independent of Map insertion order', () => {
    const first = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    const again = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    const reversed = new Map([...mergeClassesFixture().entries()].reverse());
    const shuffled = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: reversed });

    expect(again).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it('normalises CRLF input so output is byte-identical to the LF input', () => {
    const lf = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    const crlfClasses = new Map(
      [...mergeClassesFixture()].map(([name, source]) => [
        name,
        { ...source, main: source.main.replace(/\n/g, '\r\n'), definitionsPrelude: source.definitionsPrelude?.replace(/\n/g, '\r\n') },
      ]),
    );
    const crlf = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: crlfClasses as Map<string, DevClassSource> });
    expect(crlf).toEqual(lf);
    expect(lf.handler.definitions).not.toContain('\r');
  });

  it('does not require standalone sources in the classes map', () => {
    // MERGE_MANIFEST lists ZCL_MY_SETUP as standalone but the map has no entry for it.
    expect(mergeClassesFixture().has('ZCL_MY_SETUP')).toBe(false);
    const result = mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: mergeClassesFixture() });
    expect(result.orderedLocals.length).toBe(MERGE_MANIFEST.merged.length);
  });

  it('handles a handler name that is a prefix of a merged global class name', () => {
    const manifest: DeployManifest = {
      handler: 'ZCL_ABAP_VIBE_ICF',
      merged: [{ global: 'ZCL_ABAP_VIBE_ICF_TYPES', local: 'lcl_types' }],
      standalone: [],
    };
    const handlerMain = [
      'CLASS zcl_abap_vibe_icf DEFINITION PUBLIC CREATE PUBLIC.',
      '  PUBLIC SECTION.',
      '    INTERFACES if_http_extension.',
      'ENDCLASS.',
      '',
      'CLASS zcl_abap_vibe_icf IMPLEMENTATION.',
      '  METHOD if_http_extension~handle_request.',
      '    zcl_abap_vibe_icf_types=>handle( server ).',
      '  ENDMETHOD.',
      'ENDCLASS.',
      '',
    ].join('\n');
    const typesMain = classMain({
      global: 'ZCL_ABAP_VIBE_ICF_TYPES',
      definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS handle IMPORTING io_server TYPE REF TO if_http_server.',
    });

    const result = mergeReleaseSources({
      manifest,
      classes: new Map([
        ['ZCL_ABAP_VIBE_ICF', { main: handlerMain }],
        ['ZCL_ABAP_VIBE_ICF_TYPES', { main: typesMain }],
      ]),
    });

    expect(result.handler.main).toContain('CLASS zcl_abap_vibe_icf DEFINITION PUBLIC CREATE PUBLIC.');
    expect(result.handler.main).toContain('CLASS zcl_abap_vibe_icf IMPLEMENTATION.');
    expect(result.handler.main).toContain('lcl_types=>handle( server ).');
    expect(result.handler.main).not.toMatch(/ZCL_ABAP_VIBE_ICF_TYPES/i);
    expect(result.handler.definitions).toContain('CLASS lcl_types DEFINITION.');
  });
});

/* -------------------------------------------------------------------------- */
/* Release merge — definitions preludes and ordering */
/* -------------------------------------------------------------------------- */

describe('mergeReleaseSources — definitions preludes and dependency order', () => {
  const manifest: DeployManifest = {
    handler: 'ZCL_MY_HANDLER',
    merged: [
      { global: 'ZCL_MY_RESPONSE', local: 'lcl_response' },
      { global: 'ZCL_MY_MIME', local: 'lcl_mime' },
      { global: 'ZCL_MY_TYPES', local: 'lcl_types' },
    ],
    standalone: [],
  };

  function classes(): Map<string, DevClassSource> {
    return new Map<string, DevClassSource>([
      ['ZCL_MY_HANDLER', { main: MERGE_HANDLER_MAIN }],
      [
        'ZCL_MY_RESPONSE',
        {
          main: classMain({
            global: 'ZCL_MY_RESPONSE',
            definitionBody: [
              '  PUBLIC SECTION.',
              '    CLASS-METHODS handle_root RETURNING VALUE(rs_root) TYPE zcl_my_types=>ty_root.',
            ].join('\n'),
          }),
          definitionsPrelude: '*"* response prelude',
        },
      ],
      [
        'ZCL_MY_MIME',
        {
          main: classMain({
            global: 'ZCL_MY_MIME',
            definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS dispatch.',
          }),
          definitionsPrelude: [
            '*"* TYPE-POOLS required by the MIME helper (skwf_io / skwf_url / wbmr_c_skwf_appl_name).',
            'TYPE-POOLS: skwf, wbmr.',
          ].join('\n'),
        },
      ],
      [
        'ZCL_MY_TYPES',
        {
          main: classMain({
            global: 'ZCL_MY_TYPES',
            definitionBody: '  PUBLIC SECTION.\n    TYPES: BEGIN OF ty_root, status TYPE string, END OF ty_root.',
          }),
        },
      ],
    ]);
  }

  it('emits all preludes first in manifest order, then class definitions in dependency order', () => {
    const result = mergeReleaseSources({ manifest, classes: classes() });

    // Dependency order: lcl_mime and lcl_types are ready first (manifest order),
    // lcl_response depends on lcl_types.
    expect(result.orderedLocals).toEqual(['lcl_mime', 'lcl_types', 'lcl_response']);
    expect(
      result.handler.definitions.startsWith(
        '*"* response prelude\n*"* TYPE-POOLS required by the MIME helper (skwf_io / skwf_url / wbmr_c_skwf_appl_name).\nTYPE-POOLS: skwf, wbmr.\n\n',
      ),
    ).toBe(true);
    expect(result.handler.definitions.indexOf('CLASS lcl_mime DEFINITION.')).toBeGreaterThan(
      result.handler.definitions.indexOf('TYPE-POOLS: skwf, wbmr.'),
    );
    expect(result.handler.definitions.indexOf('CLASS lcl_types DEFINITION.')).toBeGreaterThan(
      result.handler.definitions.indexOf('TYPE-POOLS: skwf, wbmr.'),
    );
  });

  it('omits empty / whitespace-only preludes', () => {
    const source = classes();
    source.set('ZCL_MY_MIME', { ...source.get('ZCL_MY_MIME')!, definitionsPrelude: '   \n\n' });
    source.set('ZCL_MY_RESPONSE', { ...source.get('ZCL_MY_RESPONSE')!, definitionsPrelude: '' });

    const result = mergeReleaseSources({ manifest, classes: source });
    expect(result.handler.definitions.startsWith('CLASS ')).toBe(true);
    expect(result.handler.definitions.startsWith('\n')).toBe(false);
  });

  it('sorts classes topologically with manifest order as the stable tie-breaker', () => {
    const scrambled: DeployManifest = {
      handler: 'ZCL_MY_HANDLER',
      merged: [
        { global: 'ZCL_MY_A', local: 'lcl_a' }, // depends on B
        { global: 'ZCL_MY_D', local: 'lcl_d' }, // independent
        { global: 'ZCL_MY_B', local: 'lcl_b' }, // depends on C
        { global: 'ZCL_MY_E', local: 'lcl_e' }, // depends on D
        { global: 'ZCL_MY_C', local: 'lcl_c' }, // independent
      ],
      standalone: [],
    };
    const referenceDefinition = (global: string, referenced: string): string =>
      classMain({
        global,
        definitionBody: [
          '  PUBLIC SECTION.',
          `    CLASS-METHODS run IMPORTING io_ref TYPE REF TO ${referenced.toLowerCase()}.`,
        ].join('\n'),
      });
    const source = new Map<string, DevClassSource>([
      ['ZCL_MY_HANDLER', { main: MERGE_HANDLER_MAIN }],
      ['ZCL_MY_A', { main: referenceDefinition('ZCL_MY_A', 'ZCL_MY_B') }],
      ['ZCL_MY_B', { main: referenceDefinition('ZCL_MY_B', 'ZCL_MY_C') }],
      ['ZCL_MY_C', { main: classMain({ global: 'ZCL_MY_C', definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS run.' }) }],
      ['ZCL_MY_D', { main: classMain({ global: 'ZCL_MY_D', definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS run.' }) }],
      ['ZCL_MY_E', { main: referenceDefinition('ZCL_MY_E', 'ZCL_MY_D') }],
    ]);

    const result = mergeReleaseSources({ manifest: scrambled, classes: source });
    expect(result.orderedLocals).toEqual(['lcl_d', 'lcl_e', 'lcl_c', 'lcl_b', 'lcl_a']);

    // Definitions are emitted in that same order.
    const positions = result.orderedLocals.map((local) =>
      result.handler.definitions.indexOf(`CLASS ${local} DEFINITION.`),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('ignores self-references when ordering definitions', () => {
    const manifest: DeployManifest = {
      handler: 'ZCL_MY_HANDLER',
      merged: [{ global: 'ZCL_MY_SELF', local: 'lcl_self' }],
      standalone: [],
    };
    const source = new Map<string, DevClassSource>([
      ['ZCL_MY_HANDLER', { main: MERGE_HANDLER_MAIN }],
      [
        'ZCL_MY_SELF',
        {
          main: classMain({
            global: 'ZCL_MY_SELF',
            definitionBody: [
              '  PUBLIC SECTION.',
              '    CLASS-METHODS clone IMPORTING io_self TYPE REF TO zcl_my_self.',
            ].join('\n'),
          }),
        },
      ],
    ]);

    const result = mergeReleaseSources({ manifest, classes: source });
    expect(result.orderedLocals).toEqual(['lcl_self']);
    expect(result.handler.definitions).toContain('TYPE REF TO lcl_self.');
  });

  it('reports a dependency cycle with the classes on the cycle', () => {
    const manifest: DeployManifest = {
      handler: 'ZCL_MY_HANDLER',
      merged: [
        { global: 'ZCL_MY_A', local: 'lcl_a' },
        { global: 'ZCL_MY_B', local: 'lcl_b' },
      ],
      standalone: [],
    };
    const source = new Map<string, DevClassSource>([
      ['ZCL_MY_HANDLER', { main: MERGE_HANDLER_MAIN }],
      [
        'ZCL_MY_A',
        { main: classMain({ global: 'ZCL_MY_A', definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS run IMPORTING io_ref TYPE REF TO zcl_my_b.' }) },
      ],
      [
        'ZCL_MY_B',
        { main: classMain({ global: 'ZCL_MY_B', definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS run IMPORTING io_ref TYPE REF TO zcl_my_a.' }) },
      ],
    ]);

    const error = expectErrorCode(() => mergeReleaseSources({ manifest, classes: source }), 'DEPLOY_MERGE_FAILED');
    const cycle = error.details?.cycle as string[];
    expect(Array.isArray(cycle)).toBe(true);
    expect(cycle.length).toBeGreaterThanOrEqual(3);
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['lcl_a', 'lcl_b']));
    expect(error.message).toContain('cyclic dependency');
  });

  it('fails when a definitions prelude still contains a merged global class name', () => {
    const source = classes();
    source.set('ZCL_MY_MIME', {
      ...source.get('ZCL_MY_MIME')!,
      definitionsPrelude: '*"* definitions include for ZCL_MY_MIME',
    });

    const error = expectErrorCode(() => mergeReleaseSources({ manifest, classes: source }), 'DEPLOY_MERGE_FAILED');
    expect(error.details).toMatchObject({ class: 'ZCL_MY_MIME', section: 'definitions', stage: 'verify' });
  });
});

/* -------------------------------------------------------------------------- */
/* Release merge — input validation and split failures */
/* -------------------------------------------------------------------------- */

describe('mergeReleaseSources — invalid inputs', () => {
  it('requires the handler source in the classes map', () => {
    const source = mergeClassesFixture();
    source.delete('ZCL_MY_HANDLER');
    const error = expectErrorCode(() => mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: source }), 'DEPLOY_MANIFEST_INVALID');
    expect(error.details).toMatchObject({ field: 'classes', class: 'ZCL_MY_HANDLER' });
  });

  it('requires a source for every merged class', () => {
    const source = mergeClassesFixture();
    source.delete('ZCL_MY_HTTP');
    const error = expectErrorCode(() => mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: source }), 'DEPLOY_MANIFEST_INVALID');
    expect(error.details?.missing).toEqual(['ZCL_MY_HTTP']);
  });

  it('validates a manifest object passed straight to the merger', () => {
    const manifest: DeployManifest = {
      handler: 'ZCL_MY_HANDLER',
      merged: [{ global: 'ZCL_MY_TYPES', local: 'LCL_TYPES' }],
      standalone: [],
    };
    const error = expectErrorCode(
      () => mergeReleaseSources({ manifest, classes: mergeClassesFixture() }),
      'DEPLOY_MANIFEST_INVALID',
    );
    expect(error.details?.field).toBe('merged[0].local');
  });

  it('fails when a merged dev source has no DEFINITION header', () => {
    const source = mergeClassesFixture();
    source.set('ZCL_MY_TYPES', { main: 'just a comment\n' });
    const error = expectErrorCode(() => mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: source }), 'DEPLOY_MERGE_FAILED');
    expect(error.details).toMatchObject({ class: 'ZCL_MY_TYPES', stage: 'split' });
  });

  it('fails when the definition block is not closed with ENDCLASS', () => {
    const source = mergeClassesFixture();
    source.set('ZCL_MY_TYPES', { main: MERGE_TYPES_MAIN.replace(/\nENDCLASS\.\n$/, '\n') });
    const error = expectErrorCode(() => mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: source }), 'DEPLOY_MERGE_FAILED');
    expect(error.details).toMatchObject({ class: 'ZCL_MY_TYPES', stage: 'split' });
  });

  it('fails when the implementation block is not closed with ENDCLASS', () => {
    const source = mergeClassesFixture();
    source.set('ZCL_MY_HTTP', { main: MERGE_HTTP_MAIN.replace(/\nENDCLASS\.\n$/, '\n') });
    const error = expectErrorCode(() => mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: source }), 'DEPLOY_MERGE_FAILED');
    expect(error.details).toMatchObject({ class: 'ZCL_MY_HTTP', stage: 'split' });
  });

  it('fails when the implementation appears before the definition', () => {
    const source = mergeClassesFixture();
    const implementation = [
      'CLASS zcl_my_types IMPLEMENTATION.',
      '  METHOD run.',
      '  ENDMETHOD.',
      'ENDCLASS.',
      '',
    ].join('\n');
    source.set('ZCL_MY_TYPES', {
      main: `${implementation}${MERGE_TYPES_MAIN}`,
    });
    const error = expectErrorCode(() => mergeReleaseSources({ manifest: MERGE_MANIFEST, classes: source }), 'DEPLOY_MERGE_FAILED');
    expect(error.details).toMatchObject({ class: 'ZCL_MY_TYPES', stage: 'split' });
  });
});

/* -------------------------------------------------------------------------- */
/* Dev-form activation order */
/* -------------------------------------------------------------------------- */

const DEV_MANIFEST: DeployManifest = {
  handler: 'ZCL_MY_HANDLER',
  merged: [
    { global: 'ZCL_MY_DDIC', local: 'lcl_ddic' },
    { global: 'ZCL_MY_FORMAT', local: 'lcl_format' },
    { global: 'ZCL_MY_TYPES', local: 'lcl_types' },
  ],
  standalone: ['ZCL_MY_SETUP', 'ZCL_MY_RUNNER'],
};

function devOrderClasses(): Map<string, DevClassSource> {
  return new Map<string, DevClassSource>([
    [
      'ZCL_MY_DDIC',
      {
        main: classMain({
          global: 'ZCL_MY_DDIC',
          // Definition references the types helper, implementation references the format helper.
          definitionBody: [
            '  PUBLIC SECTION.',
            '    CLASS-METHODS create IMPORTING is_header TYPE zcl_my_types=>ty_header.',
          ].join('\n'),
          implementationBody: [
            '  METHOD create.',
            '    " format helpers must be active before this class can be activated',
            '    zcl_my_format=>format( ).',
            '  ENDMETHOD.',
          ].join('\n'),
        }),
      },
    ],
    ['ZCL_MY_FORMAT', { main: classMain({ global: 'ZCL_MY_FORMAT', definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS format.' }) }],
    [
      'ZCL_MY_TYPES',
      {
        main: classMain({
          global: 'ZCL_MY_TYPES',
          definitionBody: '  PUBLIC SECTION.\n    TYPES: BEGIN OF ty_header, name TYPE string, END OF ty_header.',
        }),
      },
    ],
    ['ZCL_MY_HANDLER', { main: MERGE_HANDLER_MAIN.replace(/zcl_my_response/g, 'zcl_my_ddic') }],
  ]);
}

describe('orderDevObjects', () => {
  it('orders merged classes topologically (implementation references count), then handler, then standalone', () => {
    const order = orderDevObjects(DEV_MANIFEST, devOrderClasses());

    expect(order).toEqual([
      'ZCL_MY_FORMAT',
      'ZCL_MY_TYPES',
      'ZCL_MY_DDIC',
      'ZCL_MY_HANDLER',
      'ZCL_MY_SETUP',
      'ZCL_MY_RUNNER',
    ]);
    // The handler is activated after every merged helper but before standalone setup/runner.
    expect(order.indexOf('ZCL_MY_HANDLER')).toBeGreaterThan(order.indexOf('ZCL_MY_DDIC'));
    expect(order.indexOf('ZCL_MY_HANDLER')).toBeLessThan(order.indexOf('ZCL_MY_SETUP'));
    // The format helper is referenced from the DDIC implementation and must come first.
    expect(order.indexOf('ZCL_MY_FORMAT')).toBeLessThan(order.indexOf('ZCL_MY_DDIC'));
    expect(order.indexOf('ZCL_MY_TYPES')).toBeLessThan(order.indexOf('ZCL_MY_DDIC'));
  });

  it('is deterministic and returns exactly one entry per deployable object', () => {
    const first = orderDevObjects(DEV_MANIFEST, devOrderClasses());
    const second = orderDevObjects(DEV_MANIFEST, devOrderClasses());
    expect(second).toEqual(first);
    expect(first.length).toBe(DEV_MANIFEST.merged.length + 1 + DEV_MANIFEST.standalone.length);
    expect(new Set(first).size).toBe(first.length);
  });

  it('keeps manifest order for independent merged classes (stable tie-breaker)', () => {
    const manifest: DeployManifest = {
      handler: 'ZCL_MY_HANDLER',
      merged: [
        { global: 'ZCL_MY_B', local: 'lcl_b' },
        { global: 'ZCL_MY_A', local: 'lcl_a' },
        { global: 'ZCL_MY_C', local: 'lcl_c' },
      ],
      standalone: [],
    };
    const source = new Map<string, DevClassSource>([
      ['ZCL_MY_HANDLER', { main: MERGE_HANDLER_MAIN }],
      ['ZCL_MY_A', { main: classMain({ global: 'ZCL_MY_A', definitionBody: '  PUBLIC SECTION.' }) }],
      ['ZCL_MY_B', { main: classMain({ global: 'ZCL_MY_B', definitionBody: '  PUBLIC SECTION.' }) }],
      ['ZCL_MY_C', { main: classMain({ global: 'ZCL_MY_C', definitionBody: '  PUBLIC SECTION.' }) }],
    ]);

    expect(orderDevObjects(manifest, source)).toEqual(['ZCL_MY_B', 'ZCL_MY_A', 'ZCL_MY_C', 'ZCL_MY_HANDLER']);
  });

  it('ignores self-references', () => {
    const manifest: DeployManifest = {
      handler: 'ZCL_MY_HANDLER',
      merged: [{ global: 'ZCL_MY_SELF', local: 'lcl_self' }],
      standalone: [],
    };
    const source = new Map<string, DevClassSource>([
      ['ZCL_MY_SELF', {
        main: classMain({
          global: 'ZCL_MY_SELF',
          definitionBody: '  PUBLIC SECTION.\n    CLASS-METHODS clone IMPORTING io_self TYPE REF TO zcl_my_self.',
          implementationBody: '  METHOD clone.\n    zcl_my_self=>clone( io_self ).\n  ENDMETHOD.',
        }),
      }],
    ]);

    expect(orderDevObjects(manifest, source)).toEqual(['ZCL_MY_SELF', 'ZCL_MY_HANDLER']);
  });

  it('reports an implementation-only dependency cycle', () => {
    const manifest: DeployManifest = {
      handler: 'ZCL_MY_HANDLER',
      merged: [
        { global: 'ZCL_MY_A', local: 'lcl_a' },
        { global: 'ZCL_MY_B', local: 'lcl_b' },
      ],
      standalone: [],
    };
    const source = new Map<string, DevClassSource>([
      ['ZCL_MY_A', {
        main: classMain({
          global: 'ZCL_MY_A',
          definitionBody: '  PUBLIC SECTION.',
          implementationBody: '  METHOD run.\n    zcl_my_b=>run( ).\n  ENDMETHOD.',
        }),
      }],
      ['ZCL_MY_B', {
        main: classMain({
          global: 'ZCL_MY_B',
          definitionBody: '  PUBLIC SECTION.',
          implementationBody: '  METHOD run.\n    zcl_my_a=>run( ).\n  ENDMETHOD.',
        }),
      }],
    ]);

    const error = expectErrorCode(() => orderDevObjects(manifest, source), 'DEPLOY_MERGE_FAILED');
    expect(error.details?.stage).toBe('dev-order');
    expect(error.details?.cycle).toContain('lcl_a');
  });

  it('requires a source for every merged class', () => {
    const source = devOrderClasses();
    source.delete('ZCL_MY_FORMAT');
    const error = expectErrorCode(() => orderDevObjects(DEV_MANIFEST, source), 'DEPLOY_MANIFEST_INVALID');
    expect(error.details?.missing).toEqual(['ZCL_MY_FORMAT']);
  });

  it('validates the manifest', () => {
    const manifest: DeployManifest = {
      handler: 'zcl_my_handler',
      merged: [],
      standalone: [],
    };
    expectErrorCode(() => orderDevObjects(manifest, new Map()), 'DEPLOY_MANIFEST_INVALID');
  });
});
