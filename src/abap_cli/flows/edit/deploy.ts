import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError, toErrorShape } from '../../output/json.js';
import { affObjectToken, buildFilename, resolveFile } from '../../formats/file-resolver.js';
import { readAbapFile } from '../../formats/abap-source.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../../core/resolve.js';
import { pushObject } from './push-object.js';
import {
  loadDeployManifest,
  mergeReleaseSources,
  orderDevObjects,
  type DeployManifest,
  type DevClassSource,
} from './deploy-merge.js';
import { probeAdtRuntime, steampunkDeployHint, type AdtRuntime, type RuntimeProbeResult } from '../../adc/runtime-probe.js';
import { getOrProbeRuntime } from '../../config/runtime-cache.js';
import { executeIcfRegister } from '../../adc/icf-register-registry.js';
import '../../adc/icf-bootstrap.js';
import { collectWarning } from '../../output/meta.js';
import { toOutputPath } from '../../core/path-output.js';
import { ICF_BASE_PATH } from '../../clients/icf-version.js';

export type DeployStatus = 'deployed' | 'skipped' | 'failed';

export interface DeployFileResult {
  file: string;
  status: DeployStatus;
  reason?: string;
  code?: string;
  changed?: boolean;
}

/** Object-level deploy step: 'created' is recorded when deploy had to create the object first. */
export interface DeployObjectResult {
  object: string;
  type: string;
  status: 'created' | 'updated' | 'unchanged' | 'failed';
  reason?: string;
  code?: string;
}

/** ICF node state reported after the setup step. */
export interface DeployIcfNode {
  status: 'success' | 'error' | 'planned';
  action?: 'created' | 'updated' | 'already_active';
  url?: string;
  active?: boolean;
  handler?: string;
}

export interface DeploymentSummary {
  files: DeployFileResult[];
  objects: DeployObjectResult[];
  forced: boolean;
  dryRun: boolean;
  /** Bundled-service form: `release` = dev classes merged into the handler; `dev` = every class installed globally. */
  mode: 'dev' | 'release';
  /** release only: number of development classes folded into the handler's includes. */
  mergedClasses?: number;
  /** ICF node state after the setup step (absent when no setup ran). */
  icfNode?: DeployIcfNode;
  /** detected ADT runtime tier (steampunk / netweaver740 / netweaver750 / unknown). */
  runtime?: AdtRuntime;
  /** deploy kind — `full` on on-prem, `source-only` on Steampunk (no auto-SICF). */
  deployKind?: 'full' | 'source-only';
}

export interface DeployOptions {
  transport: string;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  yes?: boolean;
  /** Deploy the global-class development form (maintainers; skips the release merge). */
  dev?: boolean;
  /** Target SAP package for any auto-created objects. Defaults to '$TMP'. */
  package?: string;
  /** Overridable for tests; defaults to the bundled abap/src directory. */
  sourceDir?: string;
  /** profile name for ADT runtime detection. Optional — when absent
   *  the runtime falls back to 'unknown' and deploy uses on-prem behaviour. */
  profileName?: string;
}

/**
 * Resolve the bundled abap/src directory — the package root whose abap/src
 * holds the ICF handler sources. Walk up from this module so it works from
 * src/ (unit tests), dist/ (runtime symlink), and an installed npm layout;
 * a naive fixed-depth relative path silently misses on one of those.
 */
export function bundledSourceDir(): string {
  const marker = path.join('abap', 'src', 'zcl_abap_vibe_icf.clas.abap');
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, marker))) {
      return path.join(dir, 'abap', 'src');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new CliError('CONFIG_ERROR', 'Cannot locate the bundled abap/src directory next to this CLI installation', {
    nextSteps: ['Ensure the package ships its abap/src folder (npm files list).', 'Re-install or rebuild the CLI so dist/ sits next to abap/src.'],
  });
}

/** Map user-facing ADT type to the abap-adt-api `objtype` for createObject. */
const ADT_OBJTYPE: Record<string, string> = {
  CLAS: 'CLAS/OC',
  INTF: 'INTF/OI',
  PROG: 'PROG/P',
  FUGR: 'FUGR/F',
};

interface BundledSource {
  filePath: string;
  rel: string;
  objectName: string;
  objectType: string;
  subtype: string;
  route: 'adt' | 'icf' | 'textpool';
  /** Cached file content (read once). */
  content: string;
  /** Description from the matching <name>.<type>.json (if any). */
  description: string;
  /** Original language from the matching <name>.<type>.json (if any). */
  originalLanguage?: string;
}

interface BundledObject {
  name: string;
  type: string;
  parts: BundledSource[];
}

/**
 * Deploy the bundled ABAP sources (abap/src/) via the push pipeline.
 * Auto-creates any object that does not yet exist on the target system
 * (using the bundled <name>.<type>.json metadata for description/language).
 */
export async function deployBundled(client: AdtClientWrapper, opts: DeployOptions): Promise<DeploymentSummary> {
  const sourceDir = opts.sourceDir ?? bundledSourceDir();
  const files = await enumerateSources(sourceDir);

  // Non-interactive confirmation gate: actual deploys mutate SAP.
  if (!opts.dryRun && !opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', 'abap deploy modifies SAP; confirm with --yes in non-interactive mode', {
      nextSteps: ['Re-run with --yes to confirm the deployment.', 'Or use --dry-run to preview without changes.'],
      example: 'abap deploy --yes',
    });
  }

  const manifest = await loadManifestIfPresent(sourceDir);
  const merged = manifest !== undefined && !opts.dev;
  const bundled = merged
    ? await loadReleaseSources(sourceDir, files, manifest)
    : await loadBundledSources(sourceDir, files);
  const ordered = merged
    ? bundled
    : manifest !== undefined
      ? orderDevFormObjects(bundled, manifest)
      : bundled;
  const objectResults: DeployObjectResult[] = [];
  const fileResults: DeployFileResult[] = [];

  // Detect ADT runtime tier to branch deploy behaviour (Steampunk blocks
  // cl_icf_tree). Probe failure is non-blocking and falls back to on-prem.
  // Prefer the cached runtime written by `profile test` / `init`; only
    // re-probe the network when the cache is absent or empty.
  const cachedRuntime = opts.profileName
    ? await getOrProbeRuntime(opts.profileName).catch(() => undefined)
    : undefined;
  const runtimeResult = cachedRuntime
    ? { runtime: cachedRuntime.tier as AdtRuntime, icfSetupBlocked: cachedRuntime.icfSetupBlocked }
    : opts.profileName
      ? await probeAdtRuntime(opts.profileName).catch(() => undefined)
      : undefined;
  const runtime: AdtRuntime = runtimeResult?.runtime ?? 'unknown';
  const isSteampunk = runtime === 'steampunk';

  for (const obj of ordered) {
    const objectResult = await deployOneObject(client, obj, opts, fileResults);
    objectResults.push(objectResult);
  }

  // ICF setup: create/bind/activate the SICF node after source deploy.
  // --dry-run only plans the step; it never triggers a mutating call.
  // On Steampunk the setup step is source-only — cl_icf_tree is blocked
  // by the Released APIs whitelist. We surface this as a structured warning
  // and emit a Cloud Foundry destination hint via steampunkDeployHint().
  // Dispatch through the ICF register registry — the chosen strategy
  // decides whether to mutate, plan, or hint. Dry-run always short-circuits
  // to 'planned' regardless of strategy; the registry call still runs so the
  // summary reports which strategy would have been selected.
  let icfNode: DeployIcfNode | undefined;
  const strategySpec = {
    name: 'abap_cli',
    description: 'abap-cli ICF Services',
    handler: 'ZCL_ABAP_VIBE_ICF',
    urlPath: ICF_BASE_PATH,
    state: 'active' as const,
    ...(opts.transport ? { transport: opts.transport } : {}),
  };
  // Build a synthetic probe result for the registry dispatch — the registry
  // only inspects `runtime` and `apiCapabilities`, both available here.
  const probeForRegistry: RuntimeProbeResult = {
    runtime,
    source: 'none',
    icfSetupBlocked: cachedRuntime?.icfSetupBlocked ?? (runtimeResult?.icfSetupBlocked ?? false),
    ...(cachedRuntime?.apiCapabilities
      ? { apiCapabilities: cachedRuntime.apiCapabilities }
      : (runtimeResult as { apiCapabilities?: RuntimeProbeResult['apiCapabilities'] } | undefined)?.apiCapabilities
        ? { apiCapabilities: (runtimeResult as { apiCapabilities: RuntimeProbeResult['apiCapabilities'] }).apiCapabilities }
        : {}),
  };
  let outcome = opts.dryRun
    ? { status: 'planned' as const, strategyId: 'on-prem-cl-icf-tree' as const }
    : await executeIcfRegister(client, strategySpec, probeForRegistry);

  // The setup class was (re)activated moments ago. SAP's classrun endpoint can
  // still serve the class load from before the activation and answers
  // "Class does not implement if_oo_adt_classrun~main method!" even though the
  // class is active. Retry once after a short settle delay; if the edit
  // session keeps the stale handle, retry again in a fresh SAP session (the
  // session is dropped and re-created, which is what makes a manual re-run
  // succeed). Genuine setup failures (permissions, SICF errors) are reported.
  if (!opts.dryRun && outcome.status === 'error' && isStaleClassrunSetupError(outcome)) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    outcome = await executeIcfRegister(client, strategySpec, probeForRegistry);
    if (outcome.status === 'error' && isStaleClassrunSetupError(outcome)) {
      await client.logout().catch(() => undefined);
      const freshSession = await AdtClientWrapper.create().catch(() => undefined);
      if (freshSession) {
        outcome = await executeIcfRegister(freshSession, strategySpec, probeForRegistry);
      }
    }
  }

  if (outcome.status === 'planned') {
    icfNode = { status: 'planned' };
    if (!opts.dryRun && outcome.hint && outcome.hint.length > 0) {
      // Only Steampunk emits the user-facing "configure Cockpit"
      // warning. On-prem / unknown plans stay silent — they are normal
      // pre-deploy outputs, not failures.
      if (outcome.strategyId === 'steampunk-cockpit-fallback') {
        collectWarning(
          'STEAMPUNK_ICF_MANUAL',
          'ICF service node cannot be registered automatically on this BTP system; expose the handler via a Cloud Foundry destination.',
          { runtime, nextSteps: outcome.hint },
        );
      }
    }
  } else if (outcome.status === 'success') {
    icfNode = {
      status: 'success',
      action: outcome.action,
      url: ICF_BASE_PATH,
      active: outcome.active,
      handler: 'ZCL_ABAP_VIBE_ICF',
    };
  } else {
    // Setup failure is a hard error: sources may be deployed but the node is not ready.
    throw new CliError('SAP_ERROR', `ICF setup failed: ${outcome.error?.message ?? 'unknown'}`, {
      // Carry the per-object/file outcome so a failed setup does not hide
      // whether the bundled sources themselves deployed (and which object failed).
      details: {
        code: outcome.error?.code ?? 'ICF_SETUP_FAILED',
        strategyId: outcome.strategyId,
        objects: objectResults,
        files: fileResults.map((file) => ({ ...file, file: toOutputPath(file.file) })),
      },
      nextSteps: [
        'Verify the user has SICF administration permissions (e.g. S_ICF_ADMIN).',
        'Check the setup class is fully activated: abap inspect ZCL_ABAP_VIBE_ICF_SETUP --activation',
        'If any part is inactive, run: abap activate ZCL_ABAP_VIBE_ICF_SETUP --yes',
        'Re-run: abap deploy --yes to retry the setup step.',
      ],
    });
  }

  return {
    files: fileResults.map((f) => ({ ...f, file: toOutputPath(f.file) })),
    objects: objectResults,
    forced: !!opts.force,
    dryRun: !!opts.dryRun,
    mode: opts.dev ? 'dev' : 'release',
    mergedClasses: opts.dev ? undefined : (manifest?.merged.length ?? 0),
    runtime,
    deployKind: isSteampunk ? 'source-only' : 'full',
    ...(icfNode ? { icfNode } : {}),
  };
}

/**
 * Stable class-pool source URLs for a freshly created class whose
 * objectStructure is not readable yet. Mirrors the ADT object layout used by
 * `getObjectParts` (main source + the two generated includes).
 */
function classPartUrls(objectUrl: string): { subtype: string; sourceUrl: string }[] {
  const base = objectUrl.replace(/\/$/, '');
  return [
    { subtype: 'main', sourceUrl: `${base}/source/main` },
    { subtype: 'definitions', sourceUrl: `${base}/includes/definitions` },
    { subtype: 'implementations', sourceUrl: `${base}/includes/implementations` },
  ];
}

/**
 * Normalise a source text for the `--diff` comparison against real SAP:
 * SAP returns class sources with CRLF line endings and may drop the trailing
 * newline of include parts, while the bundled sources use LF with a final
 * newline. Ignoring both keeps `--diff` idempotent without hiding real edits.
 */
function normaliseForSourceDiff(text: string): string {
  return text.replace(/\r\n?/g, '\n').trimEnd();
}

/**
 * True when the ICF setup classrun failed because SAP still saw the class
 * version from before its activation (class load handle not refreshed yet).
 * The retry path in the deploy flow only targets this transient symptom.
 */
function isStaleClassrunSetupError(outcome: { error?: { code?: string; message?: string } }): boolean {
  const code = outcome.error?.code;
  const message = outcome.error?.message ?? '';
  return code === 'ICF_SETUP_OUTPUT' || /does not implement if_oo_adt_classrun~main/i.test(message);
}

/**
 * Deploy one object: create it if missing, then push all its parts. Errors
 * against one object do not abort the others — they surface as a per-object
 * entry with a `failed` status and per-file `skipped` entries.
 */
async function deployOneObject(
  client: AdtClientWrapper,
  obj: BundledObject,
  opts: DeployOptions,
  fileResults: DeployFileResult[],
): Promise<DeployObjectResult> {
  // Resolve or create the object. Auto-create is only attempted for source
  // objects in the ADT route (CLAS/INTF/PROG/FUGR) — DDIC .json files are
  // filtered out by enumerateSources and are not part of this flow.
  let resolved;
  let createdHere = false;
  try {
    resolved = await resolveObject(client, obj.name, obj.type);
  } catch (error: unknown) {
    if (!(error instanceof CliError) || error.code !== 'OBJECT_NOT_FOUND') {
      const err = toErrorShape(error);
      return recordObjectFailure(obj, fileResults, err.code as string, err.message as string);
    }
    // Object does not exist — try to create it.
    try {
      const objtype = ADT_OBJTYPE[obj.type];
      if (!objtype) {
        return recordObjectFailure(
          obj,
          fileResults,
          'TYPE_NOT_SUPPORTED',
          `Cannot auto-create objects of type ${obj.type} during deploy`,
        );
      }
      const description = obj.parts[0]?.description || `Auto-created by abap deploy`;
      if (opts.dryRun) {
        // Plan-only: do not call createObject; record a planned creation.
        for (const p of obj.parts) {
          fileResults.push({ file: p.rel, status: 'deployed', changed: undefined });
        }
        return { object: obj.name, type: obj.type, status: 'created' };
      }
      const targetPackage = (opts.package ?? '$TMP').trim().toUpperCase();
      await client.createObject({
        objtype: objtype as Parameters<AdtClientWrapper['createObject']>[0]['objtype'],
        name: obj.name,
        parentName: targetPackage,
        description,
        parentPath: `/sap/bc/adt/packages/${encodeURIComponent(targetPackage)}`,
        transport: opts.transport,
      });
      createdHere = true;
      // Re-resolve to pick up the freshly minted object URL.
      resolved = await resolveObject(client, obj.name, obj.type);
    } catch (createError: unknown) {
      const err = toErrorShape(createError);
      return recordObjectFailure(obj, fileResults, err.code as string, (err.message as string) ?? 'create failed');
    }
  }

  // Fetch live source-part URLs for the object. A class that was created a
  // moment ago can still be unreadable via objectStructure on real SAP
  // ("Resource <name>: wrong input data for processing"); retry briefly and,
  // for a freshly created CLAS, fall back to the stable source/includes URLs.
  let parts: { subtype: string; sourceUrl: string }[];
  try {
    const live = await getObjectParts(client, resolved, createdHere ? 4 : 0, 500);
    parts = live;
  } catch (error: unknown) {
    if (createdHere && obj.type.toUpperCase() === 'CLAS') {
      parts = classPartUrls(resolved.objectUrl);
    } else {
      const err = toErrorShape(error);
      return recordObjectFailure(obj, fileResults, err.code as string, err.message as string);
    }
  }

  // Build a (subtype → sourceUrl) map for quick lookup; fall back to the first
  // 'main' part for any bundled part whose subtype is not exposed (e.g. PROG).
  const partBySubtype = new Map(parts.map((p) => [p.subtype, p.sourceUrl]));
  const fallbackUrl = partBySubtype.get('main') ?? parts[0]?.sourceUrl;

  // Per-part push (one pushObject call so the lock is acquired once per object).
  const pushParts: { subtype: string; sourceUrl: string; content: string }[] = [];
  for (const p of obj.parts) {
    const url = partBySubtype.get(p.subtype) ?? fallbackUrl;
    if (!url) {
      fileResults.push({ file: p.rel, status: 'failed', reason: `no source URL for subtype ${p.subtype}` });
      continue;
    }
    pushParts.push({ subtype: p.subtype, sourceUrl: url, content: p.content });
  }

  // --diff: short-circuit when the remote content already matches.
  // SAP returns class sources with CRLF line endings while the checked-out
  // bundled sources use LF, so compare after normalising line endings —
  // otherwise every class is reported as changed on every run.
  if (opts.diff && !opts.force) {
    let allUnchanged = true;
    for (const p of pushParts) {
      try {
        const remote = await client.getObjectSource(p.sourceUrl);
        if (normaliseForSourceDiff(remote) !== normaliseForSourceDiff(p.content)) {
          allUnchanged = false;
          break;
        }
      } catch {
        allUnchanged = false;
        break;
      }
    }
    if (allUnchanged) {
      for (const p of obj.parts) {
        fileResults.push({ file: p.rel, status: 'skipped', reason: 'unchanged', changed: false });
      }
      return { object: obj.name, type: obj.type, status: 'unchanged' };
    }
  }

  try {
    await pushObject(
      client,
      { name: resolved.name, type: resolved.type, objectUrl: resolved.objectUrl },
      pushParts,
      { transport: opts.transport, checkOnly: false, dryRun: opts.dryRun },
    );
    // Root-URI activation inside pushObject can silently no-op on real SAP for
    // method/OSI items; re-activate every inactive
    // part of this object via activateAll so the next runClass finds the
    // expected methods (e.g. if_oo_adt_classrun~main on the setup class).
    await activateAllParts(client, resolved);
    for (const p of obj.parts) {
      fileResults.push({ file: p.rel, status: 'deployed', changed: opts.diff ? true : undefined });
    }
    return {
      object: obj.name,
      type: obj.type,
      status: createdHere ? 'created' : 'updated',
    };
  } catch (error: unknown) {
    const err = toErrorShape(error);
    for (const p of obj.parts) {
      fileResults.push({ file: p.rel, status: 'failed', code: err.code as string, reason: err.message as string });
    }
    return { object: obj.name, type: obj.type, status: 'failed', code: err.code as string, reason: err.message as string };
  }
}

/**
 * Collect every inactive item belonging to the given object and activate them
 * via the per-item ADT endpoint. Mirrors `abap activate <object>`.
 * Errors here are surfaced as ACTIVATION_FAILED so a stale-activation state
 * never silently propagates into the subsequent ICF setup step.
 */
async function activateAllParts(
  client: AdtClientWrapper,
  resolved: { name: string; type: string; objectUrl: string },
): Promise<void> {
  const inact = (await client.inactiveObjects()) ?? [];
  const items: { uri: string; type: string; name: string; parentUri: string }[] = [];
  for (const entry of inact) {
    const obj = entry?.object as
      | { 'adtcore:uri'?: string; 'adtcore:type'?: string; 'adtcore:name'?: string }
      | undefined;
    const uri = obj?.['adtcore:uri'];
    // Method/OSI items carry a #fragment URI; match the object part only so a
    // same-prefix name (ZCL_FOO vs ZCL_FOO_BAR) never leaks in (mirrors activate).
    if (!uri || uri.split('#')[0] !== resolved.objectUrl) continue;
    items.push({
      uri,
      type: obj?.['adtcore:type'] ?? resolved.type,
      name: obj?.['adtcore:name'] ?? resolved.name,
      parentUri: uri.split('#')[0] ?? resolved.objectUrl,
    });
  }
  if (items.length === 0) return;
  try {
    await client.activateAll(items);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('ACTIVATION_FAILED', `Activation failed for ${resolved.name}: ${message}`, {
      object: resolved.name,
      stage: 'activate',
      detail: message,
    });
  }
}

function recordObjectFailure(
  obj: BundledObject,
  fileResults: DeployFileResult[],
  code: string,
  reason: string,
): DeployObjectResult {
  for (const p of obj.parts) {
    fileResults.push({ file: p.rel, status: 'failed', code, reason });
  }
  return { object: obj.name, type: obj.type, status: 'failed', code, reason };
}

/**
 * Read every bundled source into memory, group by (objectName, objectType),
 * and attach description/originalLanguage from the matching .json metadata
 * (abap-file-format v1 layout).
 */
async function loadBundledSources(sourceDir: string, files: string[]): Promise<BundledObject[]> {
  const byObject = new Map<string, BundledObject>();
  const metaCache = new Map<string, { description: string; originalLanguage?: string }>();

  for (const file of files) {
    const rel = path.relative(sourceDir, file);
    const resolved = resolveFile(file);
    if (resolved.route !== 'adt') {
      // Deploy only handles source objects; skip DDIC .json / textpool .properties.
      continue;
    }
    validateLocalFile(resolved);
    const key = `${resolved.objectName}|${resolved.objectType}`;
    let obj = byObject.get(key);
    if (!obj) {
      obj = { name: resolved.objectName, type: resolved.objectType, parts: [] };
      byObject.set(key, obj);
    }
    const content = await readAbapFile(file);
    let meta = metaCache.get(key);
    if (!meta) {
      meta = await readObjectMetadata(sourceDir, resolved.objectName, resolved.objectType);
      metaCache.set(key, meta);
    }
    obj.parts.push({
      filePath: file,
      rel,
      objectName: resolved.objectName,
      objectType: resolved.objectType,
      subtype: resolved.subtype,
      route: resolved.route,
      content,
      description: meta.description,
      originalLanguage: meta.originalLanguage,
    });
  }

  return [...byObject.values()];
}

/** Read the matching <name>.<type>.json metadata file (abap-file-format v1). */
async function readObjectMetadata(
  sourceDir: string,
  objectName: string,
  objectType: string,
): Promise<{ description: string; originalLanguage?: string }> {
  const lowerType = objectType.split('/')[0]!.toLowerCase();
  const candidates = [path.join(sourceDir, `${affObjectToken(objectName)}.${lowerType}.json`)];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as {
        header?: { description?: string; originalLanguage?: string };
        class?: { description?: string };
      };
      return {
        description: parsed.header?.description ?? parsed.class?.description ?? '',
        originalLanguage: parsed.header?.originalLanguage,
      };
    } catch {
      // try the next candidate
    }
  }
  return { description: '' };
}

/* -------------------------------------------------------------------------- */
/* Release form: merge dev global classes into the handler */
/* -------------------------------------------------------------------------- */

/** Path of `abap/deploy.json` (one level above the flat `abap/src` tree). */
function manifestPathFor(sourceDir: string): string {
  return path.resolve(sourceDir, '..', 'deploy.json');
}

/**
 * Read `abap/deploy.json` when present.
 *
 * A missing manifest keeps the historical as-is deploy (every bundled class is
 * installed as a global) instead of failing hard: an installation that lost the
 * manifest still gets a working — if larger — ICF service, and arbitrary
 * `sourceDir` overrides (tests, ad-hoc source trees) stay deployable. The
 * warning makes the degraded form visible.
 */
async function loadManifestIfPresent(sourceDir: string): Promise<DeployManifest | undefined> {
  const manifestPath = manifestPathFor(sourceDir);
  if (!existsSync(manifestPath)) {
    collectWarning(
      'DEPLOY_MANIFEST_MISSING',
      'abap/deploy.json not found next to the bundled sources; deploying every class as-is (no release merge).',
      { source: toOutputPath(manifestPath) },
    );
    return undefined;
  }
  return loadDeployManifest(sourceDir);
}

/** The single `main` source part of a bundled class, or a manifest error. */
function requireMainPart(obj: BundledObject): BundledSource {
  const main = obj.parts.find((part) => part.subtype === 'main');
  if (!main) {
    throw new CliError('DEPLOY_MANIFEST_INVALID', `bundled class ${obj.name} has no main source to deploy`, {
      details: { object: obj.name, parts: obj.parts.map((part) => part.rel) },
      nextSteps: [`Add ${affObjectToken(obj.name)}.clas.abap under abap/src, then re-run abap deploy.`],
      example: 'abap deploy --yes',
    });
  }
  return main;
}

/**
 * Enforce the release-form contract for one bundled class:
 *  - the handler only carries its main source — definitions/implementations are
 *    generated from the merged helpers and must never be committed next to it;
 *  - a merged helper may carry a definitions prelude (e.g. TYPE-POOLS) but no
 *    separate implementation include — implementations live in the main source.
 */
function assertReleaseSubtypes(obj: BundledObject, role: 'handler' | 'merged'): void {
  const allowed = role === 'handler' ? ['main'] : ['main', 'definitions'];
  const unexpected = obj.parts.filter((part) => !allowed.includes(part.subtype));
  if (unexpected.length === 0) return;
  const files = unexpected.map((part) => part.rel);
  throw new CliError(
    'DEPLOY_MANIFEST_INVALID',
    role === 'handler'
      ? `deploy handler ${obj.name} must have only its main source in abap/src (found ${files.join(', ')}); its definitions/implementations are generated at deploy time`
      : `merged helper ${obj.name} must not carry a separate implementation include (found ${files.join(', ')}); put the implementation in its .clas.abap main source`,
    {
      details: { object: obj.name, files, role },
      nextSteps: [
        'Do not commit a release-form include next to the development sources.',
        'The release form is generated by abap deploy; only the development form lives in abap/src.',
      ],
      example: 'abap deploy --dev --yes',
    },
  );
}

/** Load the dev-form class sources needed for the release merge. */
async function releaseClassSources(
  bundled: BundledObject[],
  manifest: DeployManifest,
): Promise<Map<string, DevClassSource>> {
  const byName = new Map<string, BundledObject>();
  for (const obj of bundled) {
    if (obj.type.toUpperCase() === 'CLAS') byName.set(obj.name.toUpperCase(), obj);
  }

  const mergedGlobals = new Set(manifest.merged.map((entry) => entry.global));
  const standalone = new Set(manifest.standalone);
  const classes = new Map<string, DevClassSource>();

  for (const obj of bundled) {
    if (obj.type.toUpperCase() !== 'CLAS') continue;
    const name = obj.name.toUpperCase();
    if (name !== manifest.handler && !mergedGlobals.has(name) && !standalone.has(name)) {
      throw new CliError(
        'DEPLOY_MANIFEST_INVALID',
        `bundled class ${name} is not listed in abap/deploy.json (neither handler, merged nor standalone)`,
        {
          details: { class: name },
          nextSteps: ['Add the class to "merged" (folded into the handler) or "standalone" (installed globally) in abap/deploy.json.'],
          example: 'abap deploy --yes',
        },
      );
    }
    if (name === manifest.handler) {
      assertReleaseSubtypes(obj, 'handler');
      classes.set(name, { main: requireMainPart(obj).content });
    } else if (mergedGlobals.has(name)) {
      assertReleaseSubtypes(obj, 'merged');
      const definitions = obj.parts.find((part) => part.subtype === 'definitions');
      classes.set(name, {
        main: requireMainPart(obj).content,
        ...(definitions ? { definitionsPrelude: definitions.content } : {}),
      });
    }
  }

  const expected = [manifest.handler, ...manifest.merged.map((entry) => entry.global), ...manifest.standalone];
  const missing = expected.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new CliError(
      'DEPLOY_MANIFEST_INVALID',
      `bundled sources are missing class(es) listed in abap/deploy.json: ${missing.join(', ')}`,
      {
        details: { missing },
        nextSteps: ['Add the missing .clas.abap files under abap/src, or remove the entries from abap/deploy.json.'],
        example: 'abap deploy --yes',
      },
    );
  }
  return classes;
}

/**
 * Build the release-form object list: one handler object with the generated
 * main/definitions/implementations parts, then the standalone classes as-is.
 * Non-class source objects (none today) keep their historical as-is deploy.
 */
async function loadReleaseSources(
  sourceDir: string,
  files: string[],
  manifest: DeployManifest,
): Promise<BundledObject[]> {
  const bundled = await loadBundledSources(sourceDir, files);
  const classes = await releaseClassSources(bundled, manifest);
  const merged = mergeReleaseSources({ manifest, classes });

  const handler = bundled.find(
    (obj) => obj.type.toUpperCase() === 'CLAS' && obj.name.toUpperCase() === manifest.handler,
  )!;
  const template = requireMainPart(handler);
  const generatedPart = (subtype: 'definitions' | 'implementations'): BundledSource => ({
    ...template,
    subtype,
    rel: buildFilename(handler.name, handler.type, subtype, '.abap'),
    content: subtype === 'definitions' ? merged.handler.definitions : merged.handler.implementations,
  });
  const handlerObject: BundledObject = {
    name: handler.name,
    type: handler.type,
    parts: [
      { ...template, subtype: 'main', content: merged.handler.main },
      generatedPart('definitions'),
      generatedPart('implementations'),
    ],
  };

  const standaloneObjects = manifest.standalone.map(
    (name) => bundled.find((obj) => obj.name.toUpperCase() === name)!,
  );
  const extraObjects = bundled.filter((obj) => {
    if (obj.type.toUpperCase() !== 'CLAS') return true;
    const name = obj.name.toUpperCase();
    return name !== manifest.handler && !manifest.merged.some((entry) => entry.global === name)
      && !manifest.standalone.includes(name);
  });
  return [handlerObject, ...standaloneObjects, ...extraObjects];
}

/** Dev-form class sources keyed by uppercase global name (for activation ordering). */
function devClassSources(bundled: BundledObject[], manifest: DeployManifest): Map<string, DevClassSource> {
  const byName = new Map<string, BundledObject>();
  for (const obj of bundled) {
    if (obj.type.toUpperCase() === 'CLAS') byName.set(obj.name.toUpperCase(), obj);
  }
  const names = [manifest.handler, ...manifest.merged.map((entry) => entry.global), ...manifest.standalone];
  const classes = new Map<string, DevClassSource>();
  const missing: string[] = [];
  for (const name of names) {
    const obj = byName.get(name);
    const main = obj?.parts.find((part) => part.subtype === 'main');
    if (!main) {
      missing.push(name);
      continue;
    }
    const definitions = obj!.parts.find((part) => part.subtype === 'definitions');
    classes.set(name, {
      main: main.content,
      ...(definitions ? { definitionsPrelude: definitions.content } : {}),
    });
  }
  if (missing.length > 0) {
    throw new CliError(
      'DEPLOY_MANIFEST_INVALID',
      `bundled sources are missing class(es) listed in abap/deploy.json: ${missing.join(', ')}`,
      {
        details: { missing },
        nextSteps: ['Add the missing .clas.abap files under abap/src, or remove the entries from abap/deploy.json.'],
        example: 'abap deploy --dev --yes',
      },
    );
  }
  return classes;
}

/**
 * Dev form: every class is installed as its own global object. Activation needs
 * referenced classes to be active first, so order the objects by the merged
 * dependency graph (types → response/formats → domain helpers → handler →
 * standalone) instead of readdir order. Objects outside the manifest keep their
 * relative order after the manifest objects.
 */
function orderDevFormObjects(bundled: BundledObject[], manifest: DeployManifest): BundledObject[] {
  const classes = devClassSources(bundled, manifest);
  const order = orderDevObjects(manifest, classes);
  const rank = new Map(order.map((name, index) => [name.toUpperCase(), index]));
  const position = new Map(bundled.map((obj, index) => [obj.name.toUpperCase(), index]));
  const rankOf = (name: string): number => {
    const known = rank.get(name);
    return known !== undefined ? known : order.length + (position.get(name) ?? 0);
  };
  return [...bundled].sort((a, b) => rankOf(a.name.toUpperCase()) - rankOf(b.name.toUpperCase()));
}

/** Recursively list .abap and .xml files under dir. */
async function enumerateSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await enumerateSources(full)));
    } else if (entry.name.endsWith('.abap') || entry.name.endsWith('.xml')) {
      out.push(full);
    }
  }
  return out;
}
