import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'node:url';
import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, toErrorShape } from '../output/json.js';
import { resolveFile } from '../formats/file-resolver.js';
import { readAbapFile } from '../formats/abap-source.js';
import { resolveObject, getObjectParts, validateLocalFile } from './resolve.js';
import { pushObject } from './push-flow.js';

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

/** ICF node state reported after the setup step (FR-010). */
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

  // Non-interactive confirmation gate (FR-020): actual deploys mutate SAP.
  if (!opts.dryRun && !opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', 'abap deploy modifies SAP; confirm with --yes in non-interactive mode', {
      nextSteps: ['Re-run with --yes to confirm the deployment.', 'Or use --dry-run to preview without changes.'],
      example: 'abap deploy --yes',
    });
  }

  const bundled = await loadBundledSources(sourceDir, files);
  const objectResults: DeployObjectResult[] = [];
  const fileResults: DeployFileResult[] = [];

  for (const obj of bundled) {
    const objectResult = await deployOneObject(client, obj, opts, fileResults);
    objectResults.push(objectResult);
  }

  // ICF setup: create/bind/activate the SICF node after source deploy (FR-008).
  // --dry-run only plans the step; it never triggers a mutating call (FR-009).
  let icfNode: DeployIcfNode | undefined;
  if (opts.dryRun) {
    icfNode = { status: 'planned' };
  } else {
    const setup = await runIcfSetup(client);
    if (setup.status === 'success') {
      icfNode = {
        status: 'success',
        action: setup.action,
        url: '/sap/zabap_vibe',
        active: setup.active,
        handler: 'ZCL_ABAP_VIBE_ICF',
      };
    } else {
      // Setup failure is a hard error: sources may be deployed but the node is not ready.
      throw new CliError('SAP_ERROR', `ICF setup failed: ${setup.message}`, {
        details: { code: setup.code ?? 'ICF_SETUP_FAILED' },
        nextSteps: [
          'Verify the user has SICF administration permissions (e.g. S_ICF_ADMIN).',
          'Check the setup class is fully activated: abap inspect ZCL_ABAP_VIBE_ICF_SETUP --activation',
          'If any part is inactive, run: abap activate ZCL_ABAP_VIBE_ICF_SETUP --yes',
          'Re-run: abap deploy --yes to retry the setup step.',
        ],
      });
    }
  }

  return {
    files: fileResults,
    objects: objectResults,
    forced: !!opts.force,
    dryRun: !!opts.dryRun,
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
    // method/OSI items (013 dogfooding lesson); re-activate every inactive
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
    if (!uri || !uri.startsWith(resolved.objectUrl)) continue;
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

/**
 * Trigger the bundled ICF setup class via ADT classrun and parse its JSON output.
 * The setup class prints a structured envelope: { status, action, node, error }.
 */
async function runIcfSetup(client: AdtClientWrapper): Promise<{
  status: 'success' | 'error';
  action?: 'created' | 'updated' | 'already_active';
  active?: boolean;
  code?: string;
  message?: string;
}> {
  const raw = await client.runClass('ZCL_ABAP_VIBE_ICF_SETUP');
  try {
    const parsed = JSON.parse(raw) as {
      status?: string;
      action?: string;
      node?: { active?: boolean };
      error?: { code?: string; message?: string };
    };
    if (parsed.status === 'error') {
      return { status: 'error', code: parsed.error?.code, message: parsed.error?.message };
    }
    return {
      status: 'success',
      action: parsed.action as 'created' | 'updated' | 'already_active',
      active: parsed.node?.active,
    };
  } catch {
    // Unparseable output → treat as a setup failure with the raw text for context.
    return { status: 'error', code: 'ICF_SETUP_OUTPUT', message: raw };
  }
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
