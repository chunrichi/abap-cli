import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'node:url';
import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, toErrorShape } from '../output/json.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../core/resolve.js';
import { pushObject } from './push-object.js';
import { probeAdtRuntime, steampunkDeployHint, type AdtRuntime, type RuntimeProbeResult } from '../adc/runtime-probe.js';
import { getOrProbeRuntime } from '../config/runtime-cache.js';
import { executeIcfRegister } from '../adc/icf-register-registry.js';
import '../adc/icf-bootstrap.js';
import { collectWarning } from '../output/meta.js';
import { toOutputPath } from '../core/path-output.js';

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
  /** ICF node state after the setup step (absent when no setup ran). */
  icfNode?: DeployIcfNode;
  /** 030: detected ADT runtime tier (steampunk / netweaver740 / netweaver750 / unknown). */
  runtime?: AdtRuntime;
  /** 030: deploy kind — `full` on on-prem, `source-only` on Steampunk (no auto-SICF). */
  deployKind?: 'full' | 'source-only';
}

export interface DeployOptions {
  transport: string;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  yes?: boolean;
  /** Target SAP package for any auto-created objects. Defaults to '$TMP'. */
  package?: string;
  /** Overridable for tests; defaults to the bundled abap/src directory. */
  sourceDir?: string;
  /** 030: profile name for ADT runtime detection. Optional — when absent
   *  the runtime falls back to 'unknown' and deploy uses on-prem behaviour. */
  profileName?: string;
}

// dist/src/abap_cli/sync → project root (ESM has no __dirname).
const bundledDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../abap/src');

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
  const sourceDir = opts.sourceDir ?? bundledDir;
  const files = await enumerateSources(sourceDir);

  // Non-interactive confirmation gate: actual deploys mutate SAP.
  if (!opts.dryRun && !opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', 'abap extension deploy modifies SAP; confirm with --yes in non-interactive mode', {
      nextSteps: ['Re-run with --yes to confirm the deployment.', 'Or use --dry-run to preview without changes.'],
      example: 'abap extension deploy --yes',
    });
  }

  const bundled = await loadBundledSources(sourceDir, files);
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

  for (const obj of bundled) {
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
    name: 'zabap_vibe',
    description: 'ABAP Vibe - ICF Services',
    handler: 'ZCL_ABAP_VIBE_ICF',
    urlPath: '/sap/zabap_vibe',
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
  const outcome = opts.dryRun
    ? { status: 'planned' as const, strategyId: 'on-prem-cl-icf-tree' as const }
    : await executeIcfRegister(client, strategySpec, probeForRegistry);

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
      url: '/sap/zabap_vibe',
      active: outcome.active,
      handler: 'ZCL_ABAP_VIBE_ICF',
    };
  } else {
    // Setup failure is a hard error: sources may be deployed but the node is not ready.
    throw new CliError('SAP_ERROR', `ICF setup failed: ${outcome.error?.message ?? 'unknown'}`, {
      details: { code: outcome.error?.code ?? 'ICF_SETUP_FAILED', strategyId: outcome.strategyId },
      nextSteps: [
        'Verify the user has SICF administration permissions (e.g. S_ICF_ADMIN).',
        'Check the setup class is fully activated: abap inspect ZCL_ABAP_VIBE_ICF_SETUP --activation',
        'If any part is inactive, run: abap activate ZCL_ABAP_VIBE_ICF_SETUP --yes',
        'Re-run: abap extension deploy --yes to retry the setup step.',
      ],
    });
  }

  return {
    files: fileResults.map((f) => ({ ...f, file: toOutputPath(f.file) })),
    objects: objectResults,
    forced: !!opts.force,
    dryRun: !!opts.dryRun,
    runtime,
    deployKind: isSteampunk ? 'source-only' : 'full',
    ...(icfNode ? { icfNode } : {}),
  };
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
      const description = obj.parts[0]?.description || `Auto-created by abap extension deploy`;
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

  // Fetch live source-part URLs for the object.
  let parts: { subtype: string; sourceUrl: string }[];
  try {
    const live = await getObjectParts(client, resolved);
    parts = live;
  } catch (error: unknown) {
    const err = toErrorShape(error);
    return recordObjectFailure(obj, fileResults, err.code as string, err.message as string);
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
  let anyChanged = false;
  if (opts.diff && !opts.force) {
    let allUnchanged = true;
    for (const p of pushParts) {
      try {
        const remote = await client.getObjectSource(p.sourceUrl);
        if (remote !== p.content) {
          allUnchanged = false;
          anyChanged = true;
          break;
        }
      } catch {
        allUnchanged = false;
        anyChanged = true;
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
 * via the per-item ADT endpoint. Mirrors `abap activate <object>` (FR-013.1).
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
  const lowerType = objectType.toLowerCase();
  const candidates = [
    path.join(sourceDir, `${objectName.toLowerCase()}.${lowerType}.json`),
    path.join(sourceDir, 'clas', `${objectName.toLowerCase()}.${lowerType}.json`),
  ];
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
