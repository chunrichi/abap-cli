import { CliError } from '../output/json.js';
import {
  enumerateFugr,
  fugrFileToken,
  isFugrTopInclude,
  isFugrUxxInclude,
  readFuncIncludeNumbers,
} from './fugr-layout.js';
import { assertAffMetadata } from '../aff/assert-metadata.js';
import {
  componentsFromFuncSections,
  parseFuncPseudoSyntax,
  toCanonicalFuncSource,
  type FuncComponent,
} from './func-pseudo.js';
import type { OutputFile, PullContext, PullStrategy } from './pull-strategy.js';

/**
 * FUGR pull strategy (abap-file-format fugr/README.md).
 *
 * Layout per function group `<name>`:
 *   `<name>.fugr.json`                       — group metadata (FUGR schema)
 *   `<name>.fugr.sapl<name>.reps.abap`       — function-pool main program (= FUGR source/main)
 *   `<name>.fugr.sapl<name>.reps.json`       — reps metadata (REPS schema, includeType: functionGroup)
 *   `<name>.fugr.l<name>top.reps.abap`       — TOP include source
 *   `<name>.fugr.l<name>top.reps.json`       — reps metadata (includeType: include)
 *   `<name>.fugr.<include>.reps.abap`        — FXX/OXX/IXX etc. (T1.5: previously dropped silently)
 *   `<name>.fugr.<include>.reps.json`        — reps metadata
 *   `<name>.fugr.<fm>.func.abap`             — canonical FUNC pseudo syntax
 *   `<name>.fugr.<fm>.func.json`             — FUNC metadata (parameters / exceptions / interface props)
 *
 * The UXX include is intentionally skipped (metadata-only). Every
 * `.json` file is `assertAffMetadata` validated before write.
 */

/** Render `<name>.fugr.json` — header + fixPointArithmetic (spec $required). */
async function renderFugrMetadata(meta: {
  description?: string;
  masterLanguage?: string;
  fixPointArithmetic?: boolean;
}): Promise<string> {
  const doc: Record<string, unknown> = {
    formatVersion: '1',
    header: {
      description: meta.description ?? '',
      originalLanguage: (meta.masterLanguage ?? 'EN').toLowerCase(),
    },
  };
  doc.fixPointArithmetic = meta.fixPointArithmetic ?? false;
  await assertAffMetadata('FUGR', doc, { context: '<name>.fugr.json' });
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Render `<name>...reps.json` — includeType is $required by REPS schema. */
async function renderRepsMetadata(
  description: string,
  includeType: 'functionGroup' | 'include',
): Promise<string> {
  const doc = { formatVersion: '1', header: { description }, includeType };
  await assertAffMetadata('REPS', doc, { context: '<name>.<include>.reps.json' });
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Render `<name>...func.json` — required fields plus interface and module properties. */
async function renderFuncMetadata(
  fm: import('./fugr-layout.js').FugrFunc,
  includeNumber: string,
): Promise<string> {
  const doc: Record<string, unknown> = {
    formatVersion: '1',
    header: { description: fm.description },
    processingType: processingTypeOf(fm.processingType),
    includeNumber,
  };
  for (const [key, value] of Object.entries({
    rfcProperties: fm.rfcProperties,
    updateProperties: fm.updateProperties,
    releaseState: releaseStateOf(fm.releaseState),
    releaseDate: fm.releaseDate,
    global: fm.global,
    exceptionClasses: fm.exceptionClasses,
    application: fm.application,
    client: fm.client,
    activeFunctionExit: fm.activeFunctionExit,
    notExecutable: fm.notExecutable,
    editLocked: fm.editLocked,
    parameters: fm.parameters,
    exceptions: fm.exceptions,
  })) {
    if (value !== undefined && (Array.isArray(value) ? value.length > 0 : true)) {
      doc[key] = value;
    }
  }
  await assertAffMetadata('FUNC', doc, { context: '<name>.<fm>.func.json' });
  return JSON.stringify(doc, null, 2) + '\n';
}

function processingTypeOf(value: string | undefined): 'normal' | 'rfc' | 'update' {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'rfc' || normalized === 'r' || normalized === 'remote') return 'rfc';
  if (normalized === 'update' || normalized === 'u') return 'update';
  return 'normal';
}

function releaseStateOf(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const values: Record<string, string> = {
    N: 'notReleased',
    E: 'released',
    I: 'releasedSapInternal',
    O: 'obsolete',
    M: 'releasePlanned',
    notreleased: 'notReleased',
    released: 'released',
    releasedsapinternal: 'releasedSapInternal',
    obsolete: 'obsolete',
    releaseplanned: 'releasePlanned',
  };
  return values[normalized.toLowerCase()] ?? values[normalized.toUpperCase()];
}

function interfaceComponents(source: string): {
  parameters: FuncComponent[];
  exceptions: FuncComponent[];
} {
  try {
    const parsed = parseFuncPseudoSyntax(source);
    const parameters = (['IMPORTING', 'EXPORTING', 'CHANGING', 'TABLES'] as const).flatMap(
      (section) => componentsFromFuncSections(parsed.sections, section),
    );
    return {
      parameters,
      exceptions: componentsFromFuncSections(parsed.sections, 'RAISING'),
    };
  } catch {
    // Unparseable sources must not block the pull — write empty interface
    // metadata so push can still round-trip the body.
    return { parameters: [], exceptions: [] };
  }
}

export function fugrStrategy(): PullStrategy {
  return {
    async files({
      client,
      object,
      opts,
    }: PullContext): Promise<OutputFile[]> {
      const layout = await enumerateFugr(
        client,
        object.objectUrl,
        (opts as { requestedFunctionModule?: { name: string; objectUrl: string } })
          .requestedFunctionModule,
      );
      const { groupFile } = layout;
      const files: OutputFile[] = [];

      const struc = await client.objectStructure(object.objectUrl);
      const meta = struc.metaData as unknown as Record<string, unknown>;

      // <name>.fugr.json
      files.push({
        filename: `${groupFile}.fugr.json`,
        content: () =>
          renderFugrMetadata({
            description: meta['adtcore:description'] as string,
            masterLanguage: meta['adtcore:masterLanguage'] as string,
            fixPointArithmetic: meta['abapsource:fixPointArithmetic'] as boolean,
          }),
      });

      // sapl<name>.reps.abap + .json (function-pool main program)
      files.push({
        filename: `${groupFile}.fugr.sapl${groupFile}.reps.abap`,
        content: () => client.getObjectSource(layout.saplUrl),
      });
      files.push({
        filename: `${groupFile}.fugr.sapl${groupFile}.reps.json`,
        content: () =>
          renderRepsMetadata((meta['adtcore:description'] as string) ?? '', 'functionGroup'),
      });

      // l<name>top.reps.abap + .json (TOP include)
      const topInclude = layout.includes.find((i) =>
        isFugrTopInclude(i.name, layout.group),
      );
      if (topInclude) {
        files.push({
          filename: `${groupFile}.fugr.l${groupFile}top.reps.abap`,
          content: () => client.getObjectSource(topInclude.sourceUrl),
        });
        files.push({
          filename: `${groupFile}.fugr.l${groupFile}top.reps.json`,
          content: () => renderRepsMetadata(topInclude.description, 'include'),
        });
      }

      // FXX / OXX / IXX (and any other non-TOP, non-UXX FUGR/I include) — T1.5
      for (const include of layout.includes.filter(
        (candidate) =>
          !isFugrTopInclude(candidate.name, layout.group) &&
          !isFugrUxxInclude(candidate.name, layout.group),
      )) {
        const includeFile = fugrFileToken(include.name);
        files.push({
          filename: `${groupFile}.fugr.${includeFile}.reps.abap`,
          content: () => client.getObjectSource(include.sourceUrl),
        });
        files.push({
          filename: `${groupFile}.fugr.${includeFile}.reps.json`,
          content: () => renderRepsMetadata(include.description, 'include'),
        });
      }

      // One .func.abap + .func.json per function module.
      // includeNumber comes from the UXX include (required by FUNC schema);
      // fall back to the module's 1-based position when UXX is missing/unparsable.
      const includeNumbers =
        layout.funcIncludeNumbers ??
        (await readFuncIncludeNumbers(client, layout.group, layout.includes));
      let funcIndex = 0;

      // sourceCache — fetch each FM's source once; reuse for both .func.abap
      // (canonical pseudo syntax) and .func.json (parameters/exceptions).
      const sourceCache = new Map<
        string,
        Promise<{
          raw: string;
          canonical: string;
          components: { parameters: FuncComponent[]; exceptions: FuncComponent[] };
        }>
      >();
      const sourceFor = (sourceUrl: string, fallbackName: string) => {
        const cached = sourceCache.get(sourceUrl);
        if (cached) return cached;
        const pending = client.getObjectSource(sourceUrl).then((raw) => ({
          raw,
          canonical: toCanonicalFuncSource(raw, fallbackName),
          components: interfaceComponents(raw),
        }));
        sourceCache.set(sourceUrl, pending);
        return pending;
      };

      for (const fm of layout.funcs) {
        const fmFile = fugrFileToken(fm.name);
        funcIndex += 1;
        const includeNumber =
          includeNumbers.get(fm.name) ?? String(funcIndex).padStart(2, '0');
        const sourceUrl = fm.sourceUrl;
        files.push({
          filename: `${groupFile}.fugr.${fmFile}.func.abap`,
          content: async () => (await sourceFor(sourceUrl, fm.name)).canonical,
        });
        files.push({
          filename: `${groupFile}.fugr.${fmFile}.func.json`,
          content: async () =>
            renderFuncMetadata(
              {
                ...fm,
                parameters: (await sourceFor(sourceUrl, fm.name)).components.parameters,
                exceptions: (await sourceFor(sourceUrl, fm.name)).components.exceptions,
              },
              includeNumber,
            ),
        });
      }

      if (files.length === 0) {
        throw new CliError(
          'SAP_ERROR',
          `No source parts found for function group ${object.name}`,
          { object: object.name },
        );
      }
      return files;
    },
  };
}
