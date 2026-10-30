/**
 * Release-form merger for the bundled ICF service.
 *
 * The ICF service is developed as a tree of normal global classes (one AFF
 * `<name>.clas.abap` per helper, abapGit style) so single-class syntax checks
 * and activations work on a real system. The published ("release") form is a
 * single global handler class instead: every helper is downgraded to a local
 * class (`lcl_*`) and folded into the handler class pool's definitions and
 * implementations includes.
 *
 * This module is deliberately pure (strings in / strings out, no ADT or
 * filesystem access except `loadDeployManifest`) so the deploy flow can reuse
 * it and the merge rules stay unit-testable.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { CliError } from '../../output/json.js';

/** Parsed and validated `abap/deploy.json`. */
export interface DeployManifest {
  /** Global handler class that receives the merged helpers (uppercase object name). */
  handler: string;
  /** Helpers that are merged into the handler, in stable manifest order. */
  merged: { global: string; local: string }[];
  /** Classes that stay global in the release form (uppercase object names). */
  standalone: string[];
}

/** One dev-form class source (definition + implementation in a single AFF main). */
export interface DevClassSource {
  /** AFF main source content (definition + implementation in the same file). */
  main: string;
  /** Optional dev-form class-pool prelude (definitions include content, e.g. TYPE-POOLS). */
  definitionsPrelude?: string;
}

export interface MergeReleaseInput {
  manifest: DeployManifest;
  /** key = uppercase global class name; must contain the handler and every merged class. */
  classes: Map<string, DevClassSource>;
}

export interface MergeReleaseResult {
  handler: { main: string; definitions: string; implementations: string };
  /** Class order actually emitted into the definitions include (lowercase local names). */
  orderedLocals: string[];
}

const OBJECT_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const LOCAL_NAME_RE = /^lcl_[a-z0-9_]+$/;
const MAX_OBJECT_NAME_LENGTH = 30;
const MAX_LOCAL_NAME_LENGTH = 30;

/* -------------------------------------------------------------------------- */
/* Manifest parsing / validation                                              */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function manifestInvalid(
  message: string,
  details: Record<string, unknown>,
  sourcePath?: string,
): CliError {
  return new CliError('DEPLOY_MANIFEST_INVALID', message, {
    details: { ...(sourcePath ? { source: sourcePath } : {}), ...details },
    nextSteps: [
      'Fix abap/deploy.json: "handler" is the release handler class, "merged" lists every helper class as {"global":"ZCL_...","local":"lcl_..."} and "standalone" lists the classes that stay global.',
      'Class names are uppercase ABAP object names (max 30 characters) and local names must match lcl_[a-z0-9_]+.',
    ],
    example: 'abap deploy --yes',
  });
}

/** Validate one uppercase ABAP object name field and return it narrowed to string. */
function readObjectName(value: unknown, field: string, sourcePath?: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw manifestInvalid(`deploy manifest field ${field} must be a non-empty class name`, { field }, sourcePath);
  }
  if (value.length > MAX_OBJECT_NAME_LENGTH) {
    throw manifestInvalid(
      `deploy manifest field ${field} is ${value.length} characters; ABAP object names are limited to ${MAX_OBJECT_NAME_LENGTH}`,
      { field, value },
      sourcePath,
    );
  }
  if (!OBJECT_NAME_RE.test(value)) {
    throw manifestInvalid(
      `deploy manifest field ${field} must be an uppercase ABAP object name (A-Z, 0-9, _), got ${JSON.stringify(value)}`,
      { field, value },
      sourcePath,
    );
  }
  return value;
}

/** Validate one local class name field and return it narrowed to string. */
function readLocalName(value: unknown, field: string, sourcePath?: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw manifestInvalid(`deploy manifest field ${field} must be a non-empty local class name`, { field }, sourcePath);
  }
  if (value.length > MAX_LOCAL_NAME_LENGTH) {
    throw manifestInvalid(
      `deploy manifest field ${field} is ${value.length} characters; local class names are limited to ${MAX_LOCAL_NAME_LENGTH}`,
      { field, value },
      sourcePath,
    );
  }
  if (!LOCAL_NAME_RE.test(value)) {
    throw manifestInvalid(
      `deploy manifest field ${field} must be a lowercase local class name matching lcl_[a-z0-9_]+, got ${JSON.stringify(value)}`,
      { field, value },
      sourcePath,
    );
  }
  return value;
}

/** Validate a parsed manifest value and return a normalised copy. */
function validateManifest(value: unknown, sourcePath?: string): DeployManifest {
  if (!isRecord(value)) {
    throw manifestInvalid('deploy manifest must be a JSON object', { field: '$', received: typeof value }, sourcePath);
  }

  const handler = readObjectName(value.handler, 'handler', sourcePath);

  if (!Array.isArray(value.merged)) {
    throw manifestInvalid('deploy manifest field merged must be an array', { field: 'merged' }, sourcePath);
  }
  if (!Array.isArray(value.standalone)) {
    throw manifestInvalid('deploy manifest field standalone must be an array', { field: 'standalone' }, sourcePath);
  }

  const merged: { global: string; local: string }[] = [];
  const globals = new Set<string>();
  const locals = new Set<string>();
  value.merged.forEach((raw, index) => {
    const field = `merged[${index}]`;
    if (!isRecord(raw)) {
      throw manifestInvalid(`deploy manifest field ${field} must be an object with global and local`, { field }, sourcePath);
    }
    const global = readObjectName(raw.global, `${field}.global`, sourcePath);
    const local = readLocalName(raw.local, `${field}.local`, sourcePath);
    if (globals.has(global)) {
      throw manifestInvalid(`deploy manifest lists merged global class ${global} more than once`, { field: `${field}.global`, class: global }, sourcePath);
    }
    if (locals.has(local)) {
      throw manifestInvalid(`deploy manifest lists merged local class ${local} more than once`, { field: `${field}.local`, class: local }, sourcePath);
    }
    globals.add(global);
    locals.add(local);
    merged.push({ global, local });
  });

  const standalone: string[] = [];
  const standaloneNames = new Set<string>();
  value.standalone.forEach((raw, index) => {
    const field = `standalone[${index}]`;
    const name = readObjectName(raw, field, sourcePath);
    if (standaloneNames.has(name)) {
      throw manifestInvalid(`deploy manifest lists standalone class ${name} more than once`, { field, class: name }, sourcePath);
    }
    if (globals.has(name)) {
      throw manifestInvalid(`deploy manifest lists class ${name} as both merged and standalone`, { field, class: name }, sourcePath);
    }
    standaloneNames.add(name);
    standalone.push(name);
  });

  if (globals.has(handler)) {
    throw manifestInvalid(`deploy manifest handler ${handler} must not also appear in merged`, { field: 'handler', class: handler }, sourcePath);
  }
  if (standaloneNames.has(handler)) {
    throw manifestInvalid(`deploy manifest handler ${handler} must not also appear in standalone`, { field: 'handler', class: handler }, sourcePath);
  }

  return { handler, merged, standalone };
}

/** Parse and validate the raw JSON text of `abap/deploy.json`. */
export function parseDeployManifest(raw: string, sourcePath?: string): DeployManifest {
  if (typeof raw !== 'string') {
    throw manifestInvalid('deploy manifest must be a JSON string', { field: '$' }, sourcePath);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw manifestInvalid(`deploy manifest is not valid JSON: ${reason}`, { field: '$', reason }, sourcePath);
  }
  return validateManifest(parsed, sourcePath);
}

/** True when the value looks like a Node fs error carrying an errno code. */
function isErrnoError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * Read `<sourceDir>/../deploy.json` — the manifest sits at the package root,
 * one level above `abap/src`, so it never pollutes the AFF tree.
 *
 * Strict by design: a missing manifest is an error. The deploy flow decides
 * on its own whether an absent manifest means "fall back to the as-is deploy".
 */
export async function loadDeployManifest(sourceDir: string): Promise<DeployManifest> {
  const manifestPath = path.resolve(sourceDir, '..', 'deploy.json');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const missing = isErrnoError(error) && error.code === 'ENOENT';
    throw new CliError(
      'DEPLOY_MANIFEST_INVALID',
      missing ? `deploy manifest not found at ${manifestPath}` : `cannot read deploy manifest at ${manifestPath}: ${reason}`,
      {
        details: { source: manifestPath, ...(missing ? {} : { reason }) },
        nextSteps: missing
          ? [
              'The release deploy form needs abap/deploy.json at the package root (one level above abap/src).',
              'Create abap/deploy.json, or use the development form: abap deploy --dev --yes',
            ]
          : ['Check the file permissions and that abap/deploy.json is readable, then re-run abap deploy.'],
        example: 'abap deploy --yes',
      },
    );
  }
  return parseDeployManifest(raw, manifestPath);
}

/* -------------------------------------------------------------------------- */
/* Dev class source splitting                                                 */
/* -------------------------------------------------------------------------- */

function mergeFailed(message: string, details: Record<string, unknown> = {}): CliError {
  return new CliError('DEPLOY_MERGE_FAILED', message, {
    details,
    nextSteps: [
      'Inspect the affected dev class source under abap/src: it must contain one CLASS <global> DEFINITION ... ENDCLASS block followed by an optional CLASS <global> IMPLEMENTATION ... ENDCLASS block.',
      'Ensure every helper reference uses the global class name registered in abap/deploy.json and that the helper dependency graph is acyclic, then re-run abap deploy.',
    ],
    example: 'abap deploy --yes',
  });
}

/** Escape a string so it can be embedded in a RegExp as a literal. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface SplitLineIndex {
  lines: string[];
  offsets: number[];
}

function indexLines(text: string): SplitLineIndex {
  const lines = text.split('\n');
  const offsets = new Array<number>(lines.length);
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    offsets[index] = offset;
    offset += lines[index]!.length + 1;
  }
  return { lines, offsets };
}

/**
 * Find the offset just past the `.` terminating the ABAP statement starting at
 * `from`. Class headers may span several attribute lines and may carry `"` or
 * full-line `*` comments, so plain `indexOf('.')` is not enough. Returns -1
 * when the statement is not terminated before EOF.
 */
function findStatementEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') {
      const newline = text.indexOf('\n', index);
      if (newline === -1) return -1;
      index = newline + 1;
      continue;
    }
    if (char === '\n') {
      // A full-line `*` comment may sit between continuation lines.
      let next = index + 1;
      while (next < text.length && (text[next] === ' ' || text[next] === '\t')) next++;
      if (text[next] === '*') {
        const newline = text.indexOf('\n', next);
        if (newline === -1) return -1;
        index = newline + 1;
        continue;
      }
      index++;
      continue;
    }
    if (char === '.') return index + 1;
    index++;
  }
  return -1;
}

/** Find the first line in [from, to) that closes a class block with ENDCLASS. */
function findEndclassLine(lines: string[], from: number, to: number): number {
  const endclassRe = /^[ \t]*ENDCLASS[ \t]*\./i;
  for (let index = from; index < to; index++) {
    if (endclassRe.test(lines[index]!)) return index;
  }
  return -1;
}

interface SplitDevClass {
  /** Leading comments + `CLASS <local> DEFINITION.` + rest up to the implementation block. */
  definition: string;
  /** `CLASS <global> IMPLEMENTATION.` ... `ENDCLASS.` block, when present. */
  implementation?: string;
}

/**
 * Split one dev-form class main into its class-pool pieces:
 *  - definition part = everything from the start of the file up to (but not
 *    including) the `CLASS <global> IMPLEMENTATION` block, with the global
 *    class header downgraded to `CLASS <local> DEFINITION.` (all
 *    PUBLIC/FINAL/CREATE PUBLIC/... attributes dropped — local classes cannot
 *    carry a global visibility);
 *  - implementation part = the `CLASS <global> IMPLEMENTATION` ... `ENDCLASS.`
 *    block. A class without an implementation (typically the shared types
 *    helper) is valid and yields no implementation part.
 *
 * Renaming global -> local names is a separate pass (`renameGlobals`).
 */
function splitDevClass(globalName: string, localName: string, rawMain: string): SplitDevClass {
  // Normalise line endings so the generated includes are byte-stable regardless
  // of the checkout platform.
  const source = rawMain.replace(/\r\n?/g, '\n');
  const { lines, offsets } = indexLines(source);
  const escapedName = escapeRegExp(globalName);
  const definitionLineRe = new RegExp(`^[ \\t]*CLASS[ \\t]+${escapedName}[ \\t]+DEFINITION\\b`, 'i');
  const implementationLineRe = new RegExp(`^[ \\t]*CLASS[ \\t]+${escapedName}[ \\t]+IMPLEMENTATION\\b`, 'i');

  // Locate the real definition header (a `DEFERRED` statement is not it).
  let definitionLine = -1;
  for (let index = 0; index < lines.length; index++) {
    if (!definitionLineRe.test(lines[index]!)) continue;
    const headerEnd = findStatementEnd(source, offsets[index]!);
    if (headerEnd === -1) break; // malformed header — reported below
    if (!/\bDEFERRED\b/i.test(source.slice(offsets[index]!, headerEnd))) {
      definitionLine = index;
      break;
    }
  }
  if (definitionLine === -1) {
    throw mergeFailed(`cannot find a CLASS ${globalName} DEFINITION header in its dev source`, {
      class: globalName,
      stage: 'split',
    });
  }

  const definitionHeaderEnd = findStatementEnd(source, offsets[definitionLine]!);
  if (definitionHeaderEnd === -1) {
    throw mergeFailed(`CLASS ${globalName} DEFINITION header is not terminated with a period`, {
      class: globalName,
      stage: 'split',
    });
  }

  let implementationLine = -1;
  for (let index = 0; index < lines.length; index++) {
    if (implementationLineRe.test(lines[index]!)) {
      implementationLine = index;
      break;
    }
  }
  if (implementationLine !== -1 && implementationLine < definitionLine) {
    throw mergeFailed(`CLASS ${globalName} IMPLEMENTATION appears before its DEFINITION block`, {
      class: globalName,
      stage: 'split',
    });
  }

  const definitionEndLine = findEndclassLine(
    lines,
    definitionLine + 1,
    implementationLine === -1 ? lines.length : implementationLine,
  );
  if (definitionEndLine === -1) {
    throw mergeFailed(`CLASS ${globalName} DEFINITION has no matching ENDCLASS before the implementation block`, {
      class: globalName,
      stage: 'split',
    });
  }

  const implementationStart = implementationLine === -1 ? source.length : offsets[implementationLine]!;
  const definition =
    source.slice(0, offsets[definitionLine]!) +
    `CLASS ${localName} DEFINITION.` +
    source.slice(definitionHeaderEnd, implementationStart);

  let implementation: string | undefined;
  if (implementationLine !== -1) {
    const implementationEndLine = findEndclassLine(lines, implementationLine + 1, lines.length);
    if (implementationEndLine === -1) {
      throw mergeFailed(`CLASS ${globalName} IMPLEMENTATION has no matching ENDCLASS`, {
        class: globalName,
        stage: 'split',
      });
    }
    const implementationEnd = offsets[implementationEndLine]! + lines[implementationEndLine]!.length;
    // Keep any trailing file footer (comments) with the implementation block so
    // no source text is silently dropped.
    implementation = source.slice(implementationStart, implementationEnd) + source.slice(implementationEnd);
  }

  return { definition, implementation };
}

/* -------------------------------------------------------------------------- */
/* Rename pass                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Rename every whole-word occurrence of each merged global class name to its
 * local name, case-insensitively (ABAP identifiers are case-insensitive and the
 * dev sources are lowercase while the manifest is uppercase).
 *
 * The `\b` boundaries are essential: `ZCL_ABAP_VIBE_ICF` is a prefix of every
 * `ZCL_ABAP_VIBE_ICF_*` helper and must never be rewritten as part of a longer
 * name. The caller controls scope — the handler's own name is never part of
 * `merged`, so it is never touched.
 */
function renameGlobals(text: string, merged: ReadonlyArray<{ global: string; local: string }>): string {
  if (text.length === 0 || merged.length === 0) return text;
  const localByGlobal = new Map(merged.map((entry) => [entry.global, entry.local]));
  const alternatives = merged
    .map((entry) => escapeRegExp(entry.global))
    .sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'gi');
  return text.replace(pattern, (match) => localByGlobal.get(match.toUpperCase()) ?? match);
}

/* -------------------------------------------------------------------------- */
/* Dependency ordering                                                        */
/* -------------------------------------------------------------------------- */

/** Collect `lcl_*` references from a (already renamed) class-pool fragment. */
function referencedLocals(text: string): Set<string> {
  const referenceRe = /\blcl_[a-z0-9_]+\b/g;
  const references = new Set<string>();
  for (const match of text.matchAll(referenceRe)) references.add(match[0]);
  return references;
}

/**
 * Stable topological order of the merged local classes.
 *
 * An edge `class -> referenced helper` means the helper must be emitted (and,
 * for the dev form, activated) first. References to classes outside the
 * manifest and self-references do not constrain the order. Ties are broken by
 * `locals` order — the manifest order — so the result depends only on the
 * input, never on Map iteration order.
 *
 * @param dependencyTexts fragment per local class to scan for references.
 */
function orderLocalsByDependencies(
  locals: string[],
  dependencyTexts: ReadonlyMap<string, string>,
  stage: string,
): string[] {
  const known = new Set(locals);
  const dependencies = new Map<string, Set<string>>();
  for (const local of locals) {
    const refs = referencedLocals(dependencyTexts.get(local) ?? '');
    const deps = new Set<string>();
    for (const ref of refs) {
      if (ref === local) continue; // a self-reference never constrains the order
      if (known.has(ref)) deps.add(ref);
    }
    dependencies.set(local, deps);
  }

  const emitted = new Set<string>();
  const order: string[] = [];
  while (order.length < locals.length) {
    // Pick the first manifest-order class whose dependencies are all emitted.
    let next: string | undefined;
    for (const local of locals) {
      if (emitted.has(local)) continue;
      const deps = dependencies.get(local) ?? new Set<string>();
      let ready = true;
      for (const dep of deps) {
        if (!emitted.has(dep)) {
          ready = false;
          break;
        }
      }
      if (ready) {
        next = local;
        break;
      }
    }
    if (next === undefined) break;
    emitted.add(next);
    order.push(next);
  }

  if (order.length === locals.length) return order;

  const unresolved = locals.filter((local) => !emitted.has(local));
  const cycle = findDependencyCycle(unresolved, dependencies);
  throw mergeFailed(`cyclic dependency between merged classes: ${cycle.join(' -> ')}`, {
    stage,
    cycle,
    classes: [...new Set(cycle)],
  });
}

/** Return one concrete dependency cycle (first and last element repeat) for error details. */
function findDependencyCycle(locals: string[], dependencies: ReadonlyMap<string, Set<string>>): string[] {
  const unresolved = new Set(locals);
  for (const start of locals) {
    const path: string[] = [];
    const indexByLocal = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined && unresolved.has(current) && !indexByLocal.has(current)) {
      indexByLocal.set(current, path.length);
      path.push(current);
      const deps: Set<string> = dependencies.get(current) ?? new Set<string>();
      let next: string | undefined;
      for (const candidate of locals) {
        if (deps.has(candidate)) {
          next = candidate;
          break;
        }
      }
      current = next;
    }
    if (current !== undefined) {
      const cycleStart = indexByLocal.get(current);
      if (cycleStart !== undefined) return [...path.slice(cycleStart), current];
    }
  }
  return locals;
}

/* -------------------------------------------------------------------------- */
/* Release merge                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Merge the dev-form global classes into the release-form single handler class.
 *
 * The generated pieces are:
 *  - `handler.main` — the dev handler main with helper references renamed to
 *    `lcl_*` (definition/implementation structure untouched);
 *  - `handler.definitions` — all definitions preludes (manifest order) followed
 *    by the local class definitions in dependency order;
 *  - `handler.implementations` — the local class implementations in the same
 *    dependency order, skipping classes that only have a definition.
 *
 * Deterministic: identical input always produces byte-identical output.
 * Throws DEPLOY_MANIFEST_INVALID for inconsistent inputs and DEPLOY_MERGE_FAILED
 * when the sources cannot be split, ordered, or fully renamed.
 */
export function mergeReleaseSources(input: MergeReleaseInput): MergeReleaseResult {
  const validated = validateManifest(input.manifest);
  if (!(input.classes instanceof Map)) {
    throw manifestInvalid('deploy merge input classes must be a Map keyed by uppercase global class name', {
      field: 'classes',
    });
  }
  const classes = input.classes;

  const handlerSource = classes.get(validated.handler);
  if (handlerSource === undefined) {
    throw manifestInvalid(`missing dev source for the deploy handler ${validated.handler}`, {
      field: 'classes',
      class: validated.handler,
      missing: [validated.handler],
    });
  }

  const missing = validated.merged.filter((entry) => !classes.has(entry.global)).map((entry) => entry.global);
  if (missing.length > 0) {
    throw manifestInvalid(`missing dev source(s) for merged class(es): ${missing.join(', ')}`, {
      field: 'classes',
      missing,
    });
  }

  const mergedLocals = validated.merged.map((entry) => entry.local);
  const definitions = new Map<string, string>();
  const implementations = new Map<string, string>();
  const preludes = new Map<string, string>();

  for (const entry of validated.merged) {
    const source = classes.get(entry.global)!;
    const split = splitDevClass(entry.global, entry.local, source.main);
    definitions.set(entry.local, renameGlobals(split.definition, validated.merged));
    if (split.implementation !== undefined) {
      implementations.set(entry.local, renameGlobals(split.implementation, validated.merged));
    }
    if (source.definitionsPrelude !== undefined) {
      preludes.set(entry.local, source.definitionsPrelude);
    }
  }

  // Definitions ordering: dependency order over references in the definition
  // parts only (implementations do not matter for compiling the class pool
  // definitions, and the contract defines the graph on definition parts).
  const orderedLocals = orderLocalsByDependencies(mergedLocals, definitions, 'merge');

  // dev definitions includes are emitted first, in manifest order.
  const preludeChunks: string[] = [];
  for (const entry of validated.merged) {
    const rawPrelude = preludes.get(entry.local);
    if (rawPrelude === undefined) continue;
    const normalised = rawPrelude.replace(/\r\n?/g, '\n').trim();
    if (normalised.length > 0) preludeChunks.push(normalised);
  }

  const definitionBlocks = orderedLocals.map((local) => definitions.get(local)!.trimEnd());
  const implementationBlocks: string[] = [];
  for (const local of orderedLocals) {
    const implementation = implementations.get(local);
    if (implementation !== undefined) implementationBlocks.push(implementation.trimEnd());
  }

  const definitionSections: string[] = [];
  if (preludeChunks.length > 0) definitionSections.push(preludeChunks.join('\n'));
  if (definitionBlocks.length > 0) definitionSections.push(definitionBlocks.join('\n\n'));
  const generatedDefinitions = definitionSections.length > 0 ? `${definitionSections.join('\n\n')}\n` : '';
  const generatedImplementations = implementationBlocks.length > 0 ? `${implementationBlocks.join('\n\n')}\n` : '';

  const renamedHandlerMain = renameGlobals(handlerSource.main.replace(/\r\n?/g, '\n'), validated.merged);
  if (renamedHandlerMain.trim().length === 0) {
    throw mergeFailed('the dev handler source is empty', { class: validated.handler, stage: 'merge' });
  }
  const handlerMain = renamedHandlerMain.trimEnd() + '\n';

  // Post-condition: no merged global class name may survive anywhere. The
  // preludes are intentionally outside the rename scope, so a prelude that
  // mentions a helper class surfaces here instead of silently shipping a
  // reference to a global class that will not exist in the release form.
  for (const entry of validated.merged) {
    const leftoverRe = new RegExp(`\\b${escapeRegExp(entry.global)}\\b`, 'i');
    const sections = [
      ['main', handlerMain],
      ['definitions', generatedDefinitions],
      ['implementations', generatedImplementations],
    ] as const;
    for (const [section, text] of sections) {
      if (leftoverRe.test(text)) {
        throw mergeFailed(
          `global class ${entry.global} still appears in the generated ${section}; the global-to-local rename missed an occurrence`,
          { class: entry.global, section, stage: 'verify' },
        );
      }
    }
  }

  return {
    handler: { main: handlerMain, definitions: generatedDefinitions, implementations: generatedImplementations },
    orderedLocals,
  };
}

/**
 * Activation order for the development form (every helper stays a global class).
 *
 * Returns uppercase object names: merged classes in dependency order first
 * (a class whose methods reference another helper comes after it), then the
 * handler, then the standalone classes in manifest order. ABAP activation needs
 * every referenced global class to be active, and implementations reference
 * helpers too (e.g. the DDIC helper calls the format helpers), so the graph is
 * built over the full dev source — definition and implementation blocks.
 */
export function orderDevObjects(manifest: DeployManifest, classes: Map<string, DevClassSource>): string[] {
  const validated = validateManifest(manifest);
  if (!(classes instanceof Map)) {
    throw manifestInvalid('deploy order input classes must be a Map keyed by uppercase global class name', {
      field: 'classes',
    });
  }

  const missing = validated.merged.filter((entry) => !classes.has(entry.global)).map((entry) => entry.global);
  if (missing.length > 0) {
    throw manifestInvalid(`missing dev source(s) for merged class(es): ${missing.join(', ')}`, {
      field: 'classes',
      missing,
    });
  }

  const dependencyTexts = new Map<string, string>();
  for (const entry of validated.merged) {
    const source = classes.get(entry.global)!;
    const split = splitDevClass(entry.global, entry.local, source.main);
    // Dev sources reference helpers by global class name; rename first so the
    // shared lcl_* reference extraction sees the local dependency names.
    const text = [split.definition, split.implementation ?? ''].join('\n');
    dependencyTexts.set(entry.local, renameGlobals(text, validated.merged));
  }

  const orderedLocals = orderLocalsByDependencies(
    validated.merged.map((entry) => entry.local),
    dependencyTexts,
    'dev-order',
  );
  const globalByLocal = new Map(validated.merged.map((entry) => [entry.local, entry.global]));
  return [
    ...orderedLocals.map((local) => globalByLocal.get(local)!),
    validated.handler,
    ...validated.standalone,
  ];
}
