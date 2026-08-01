import { Command } from 'commander';
import * as path from 'path';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { resolveFile } from '../formats/file-resolver.js';
import { listAbapFiles, readAbapFile } from '../formats/abap-source.js';
import { CliError, printError, printResult, toErrorShape } from '../output/json.js';
import { resolveObject, getObjectParts, validateLocalFile } from '../sync/resolve.js';
import { resolveTransport } from '../sync/transport.js';
import { pushObject } from '../sync/push-flow.js';

export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local ABAP files to SAP (lock → set source → syntax check → activate → unlock)')
    .argument('[files...]', 'Files to push')
    .option('--all', 'Push all .abap files under the current directory')
    .option('--tr <transport>', 'Transport number')
    .option('--check-only', 'Only perform syntax check, do not activate')
    .action(async (files: string[], opts, cmd) => {
      const json = cmd.parent?.opts()?.json ?? false;
      try {
        await runPush(files, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

interface PushFileResult {
  file: string;
  status: 'activated' | 'checked-only' | 'failed';
  transport?: string;
  code?: string;
  stage?: string;
  errors?: unknown[];
  unlock?: string;
  detail?: string;
}

async function runPush(files: string[], opts: { all?: boolean; tr?: string; checkOnly?: boolean }, json: boolean): Promise<void> {
  const fileList = await collectFiles(files, opts.all);
  const client = await AdtClientWrapper.create();
  const transport = await resolveTransport(client, opts.tr, client.getConfig().transport);

  const results: PushFileResult[] = [];
  let failed = 0;
  for (const file of fileList) {
    try {
      await pushFile(client, file, transport, opts.checkOnly ?? false);
      results.push({ file, status: opts.checkOnly ? 'checked-only' : 'activated', transport });
    } catch (error: unknown) {
      failed++;
      const err = toErrorShape(error);
      results.push({
        file,
        status: 'failed',
        code: err.code,
        stage: typeof err.stage === 'string' ? err.stage : undefined,
        errors: Array.isArray(err.errors) ? err.errors : undefined,
        unlock: typeof err.unlock === 'string' ? err.unlock : undefined,
        detail: typeof err.detail === 'string' ? err.detail : undefined,
      });
    }
  }

  if (failed > 0) {
    const single = fileList.length === 1;
    const code = single ? (results[0].code ?? 'PUSH_FAILED') : 'PUSH_FAILED';
    const payload = { code, message: `${failed} of ${fileList.length} file(s) failed`, results };
    if (json) {
      console.error(JSON.stringify({ status: 'error', error: payload }, null, 2));
    } else {
      console.error(`Error: ${failed} of ${fileList.length} file(s) failed`);
      for (const r of results.filter((x) => x.status === 'failed')) {
        console.error(`  ${r.file} — ${r.code ?? 'FAILED'}${r.stage ? ` (stage: ${r.stage})` : ''}`);
      }
    }
    process.exit(1);
  }

  printResult(json, { results, failed }, humanSummary(results));
}

async function pushFile(client: AdtClientWrapper, file: string, transport: string, checkOnly: boolean): Promise<void> {
  let resolved;
  try {
    resolved = resolveFile(file);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot parse ${file}: ${message(error)}`, { file });
  }
  validateLocalFile(resolved);

  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${file}: ${message(error)}`, { file });
  }

  const object = await resolveObject(client, resolved.objectName, resolved.objectType);
  const parts = await getObjectParts(client, object);
  const part = parts.find((p) => p.subtype === resolved.subtype) ?? parts.find((p) => p.subtype === 'main');
  if (!part) {
    throw new CliError('SAP_ERROR', `No source part matches ${resolved.subtype} for ${object.name}`, { object: object.name });
  }

  await pushObject(client, object, [{ subtype: part.subtype, sourceUrl: part.sourceUrl, content }], { transport, checkOnly });
}

async function collectFiles(files: string[], all?: boolean): Promise<string[]> {
  if (all) {
    const found = await listAbapFiles(process.cwd());
    return found.filter((f) => f.endsWith('.abap'));
  }
  if (!files || files.length === 0) {
    throw new CliError('USAGE', 'Specify files or use --all');
  }
  return files.map((f) => path.resolve(f));
}

function humanSummary(results: PushFileResult[]): string {
  const lines = [`Pushed ${results.length} file(s):`];
  for (const r of results) lines.push(`  ${r.file} → ${r.status}${r.transport ? ` (${r.transport})` : ''}`);
  return lines.join('\n');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
