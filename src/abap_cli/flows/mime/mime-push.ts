/**
 * MIME Repository resource push: upload local files into an existing
 * absolute MIME folder via ICF POST /mime/resources.
 *
 * Each file is base64-encoded and POSTed individually. The ICF service runs
 * SCMS_UPLOAD_FILE for each entry (or a single transaction wrapper when a
 * transport is provided).
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { requireWriteConfirmation } from '../../core/confirmation.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { validateMimePath } from './mime-flow.js';

export interface PushMimeResourcesOptions {
  root?: string;
  tr?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export async function enumerateLocalFiles(localPath: string): Promise<string[]> {
  const abs = resolve(process.cwd(), localPath);
  const stat = await lstat(abs);
  if (stat.isFile()) return [abs];
  if (!stat.isDirectory()) {
    throw new CliError('INVALID_ARGUMENT', `Local path is neither file nor directory: ${localPath}`, { file: localPath });
  }
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(abs);
  return out;
}

export async function pushMimeResources(localPath: string, opts: PushMimeResourcesOptions): Promise<unknown> {
  if (!opts.root) {
    throw new CliError('INVALID_ARGUMENT', 'push requires --root <mime-path> (the absolute folder to upload into)', {
      example: `abap mime push ${localPath} --root /zntf_ui/assets`,
    });
  }
  validateMimePath(opts.root);
  requireWriteConfirmation('abap mime push', { ...opts, supportsDryRun: true }, `abap mime push ${localPath} --root ${opts.root} --yes`);

  const files = await enumerateLocalFiles(localPath);
  if (files.length === 0) {
    throw new CliError('USAGE', `No files found at ${localPath}`, { file: localPath });
  }

  if (opts.dryRun) {
    return {
      dryRun: true,
      action: 'push',
      root: opts.root,
      transport: opts.tr,
      fileCount: files.length,
      plan: files.slice(0, 20).map((f) => relative(process.cwd(), f)),
    };
  }

  const icf = await IcfClient.create();
  const succeeded: string[] = [];
  const failed: Array<{ path: string; code: string; message: string }> = [];
  for (const absPath of files) {
    const buf = await readFile(absPath);
    const mimePath = join(opts.root, basename(absPath)).replaceAll('\\', '/');
    const body = {
      path: mimePath,
      contentBase64: buf.toString('base64'),
      transportRequest: opts.tr,
    };
    const resp = await icf.post<{ path: string }>('/mime/resources', body);
    if (resp.status !== 'success') {
      failed.push({
        path: relative(process.cwd(), absPath),
        code: resp.error?.code ?? 'SAP_ERROR',
        message: resp.error?.message ?? 'unknown',
      });
      continue;
    }
    succeeded.push(relative(process.cwd(), absPath));
  }

  if (failed.length > 0) {
    throw new CliError('SAP_ERROR', `${failed.length} of ${files.length} file(s) failed to upload`, {
      details: { succeeded, failed },
    });
  }

  return { root: opts.root, uploaded: succeeded.length, files: succeeded };
}