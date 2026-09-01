/**
 * MIME Repository folder create/delete via the self-built ICF service.
 *
 * Routes:
 *   POST /mime/folder      create root or child folder
 *   DELETE /mime/folder    delete folder (with --recursive)
 *
 * MIME paths use `/<segment>` segments (e.g. `/zntf_ui/assets`). The ICF
 * service runs the equivalent of `SCMS_R_CREATE_FOLDER` / `SCMS_R_DELETE_FOLDER`.
 */
import { IcfClient } from '../../clients/icf-client.js';
import { requireWriteConfirmation } from '../../core/confirmation.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';

export interface CreateMimeFolderOptions {
  package?: string;
  description?: string;
  tr?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface DeleteMimeFolderOptions {
  recursive?: boolean;
  tr?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/** MIME path must start with `/` and contain no `..` or trailing slash. */
export function validateMimePath(path: string): void {
  if (!path.startsWith('/')) {
    throw new CliError('INVALID_ARGUMENT', `MIME path must start with '/'; got '${path}'`, {
      example: 'abap mime create /zntf_ui --package $TMP',
    });
  }
  if (path.includes('..')) {
    throw new CliError('INVALID_ARGUMENT', `MIME path must not contain '..'; got '${path}'`, { path });
  }
  if (path.endsWith('/') && path.length > 1) {
    throw new CliError('INVALID_ARGUMENT', `MIME path must not end with '/'; got '${path}'`, { path });
  }
}

export async function createMimeFolder(path: string, opts: CreateMimeFolderOptions): Promise<unknown> {
  validateMimePath(path);
  requireWriteConfirmation('abap mime create', { ...opts, supportsDryRun: true }, `abap mime create ${path} --yes`);
  if (opts.dryRun) {
    return { dryRun: true, action: 'create', path, package: opts.package, description: opts.description, transport: opts.tr };
  }
  const icf = await IcfClient.create();
  const body = {
    path,
    package: opts.package ?? '$TMP',
    description: opts.description ?? '',
    transportRequest: opts.tr,
  };
  const resp = await icf.post<{ path: string; kind: 'root' | 'folder'; action: 'created' }>('/mime/folder', body);
  if (resp.status !== 'success') {
    const code = (resp.error?.code ?? 'SAP_ERROR') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to create MIME folder ${path}`, {
      details: resp.error?.details,
    });
  }
  return resp.data;
}

export async function deleteMimeFolder(path: string, opts: DeleteMimeFolderOptions): Promise<unknown> {
  validateMimePath(path);
  requireWriteConfirmation('abap mime delete', { ...opts, supportsDryRun: true }, `abap mime delete ${path} --yes`);
  if (opts.dryRun) {
    return { dryRun: true, action: 'delete', path, recursive: opts.recursive ?? false, transport: opts.tr };
  }
  const icf = await IcfClient.create();
  const query = new URLSearchParams({ recursive: opts.recursive ? 'true' : 'false' });
  if (opts.tr) query.set('transport', opts.tr);
  const resp = await icf.put<{ path: string; action: 'deleted' }>(`/mime/folder?${query.toString()}`, { path });
  if (resp.status !== 'success') {
    const code = (resp.error?.code ?? 'SAP_ERROR') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to delete MIME folder ${path}`, {
      details: resp.error?.details,
    });
  }
  return resp.data;
}