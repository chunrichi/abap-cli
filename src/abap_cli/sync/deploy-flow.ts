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

export interface DeploymentSummary {
  files: DeployFileResult[];
  forced: boolean;
  dryRun: boolean;
}

export interface DeployOptions {
  transport: string;
  dryRun?: boolean;
  diff?: boolean;
  force?: boolean;
  yes?: boolean;
  /** Overridable for tests; defaults to the bundled abap/src directory. */
  sourceDir?: string;
}

// dist/src/abap_cli/sync → project root (ESM has no __dirname).
const bundledDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../abap/src');

/**
 * Deploy the bundled ABAP sources (abap/src/) via the push pipeline
 * (FR-018..020, research §9).
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

  const results: DeployFileResult[] = [];
  for (const file of files) {
    const rel = path.relative(sourceDir, file);
    try {
      const resolved = resolveFile(file);
      validateLocalFile(resolved);
      const object = await resolveObject(client, resolved.objectName, resolved.objectType);
      const parts = await getObjectParts(client, object);
      const part = parts.find((p) => p.subtype === resolved.subtype) ?? parts.find((p) => p.subtype === 'main');
      if (!part) {
        results.push({ file: rel, status: 'skipped', reason: 'no matching source part' });
        continue;
      }
      const content = await readAbapFile(file);

      // --diff: compare local content with the deployed version.
      let changed: boolean | undefined;
      if (opts.diff) {
        const remote = await client.getObjectSource(part.sourceUrl);
        changed = remote !== content;
        if (!changed && !opts.force) {
          results.push({ file: rel, status: 'skipped', reason: 'unchanged', changed: false });
          continue;
        }
      }

      await pushObject(
        client,
        { name: object.name, type: object.type, objectUrl: object.objectUrl },
        [{ subtype: part.subtype, sourceUrl: part.sourceUrl, content }],
        { transport: opts.transport, checkOnly: false, dryRun: opts.dryRun },
      );
      results.push({ file: rel, status: 'deployed', changed });
    } catch (error: unknown) {
      const err = toErrorShape(error);
      results.push({
        file: rel,
        status: 'failed',
        code: err.code as string,
        reason: err.message as string,
      });
    }
  }

  return { files: results, forced: !!opts.force, dryRun: !!opts.dryRun };
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
