/**
 * Pull the active (00000) source of an object as transported to a remote
 * system (Version Management, RFC destination = TMSADM@<id>.DOMAIN_<id>).
 *
 * Supported types: PROG (REPS), INTF (INTF), CLAS (CLSD).
 */
import * as path from 'path';
import { IcfClient } from '../../clients/icf-client.js';
import { buildFilename, objectDirName } from '../../formats/file-resolver.js';
import { folderFor } from '../../formats/type-folder.js';
import { fileExists, writeAbapFile } from '../../formats/abap-source.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toOutputPath, normalizePullData } from '../../core/path-output.js';
import type { PullOptions, PullResult } from './pull-shared.js';

/** 015: CLI object type → Version Management (VRSD) object type for remote pulls. */
const VERSION_SOURCE_TYPES: Record<string, string> = {
  PROG: 'REPS',
  INTF: 'INTF',
  CLAS: 'CLSD',
};

export async function runPullRemote(objectName: string, type: string | undefined, remoteId: string, opts: PullOptions): Promise<PullResult> {
  const objType = (type ?? 'PROG').toUpperCase();
  const vrsdType = VERSION_SOURCE_TYPES[objType];
  if (!vrsdType) {
    throw new CliError('TYPE_NOT_SUPPORTED', `Remote pull not supported for object type ${objType}`, {
      type: objType,
      nextSteps: [`Supported types: ${Object.keys(VERSION_SOURCE_TYPES).join(', ')}.`],
      example: `abap pull ${objectName} --remote PRD`,
    });
  }
  const remoteUpper = remoteId.trim().toUpperCase();
  if (remoteUpper.length > 60 || !/^[A-Z0-9@._-]+$/.test(remoteUpper)) {
    throw new CliError('INVALID_ARGUMENT', `Invalid remote system ID '${remoteId}'`, {
      example: `abap pull ${objectName} --remote PRD`,
    });
  }

  const icf = await IcfClient.create();
  const resp = await icf.getRemoteSource<{ objectType: string; objectName: string; version: string; source: string }>(
    vrsdType,
    objectName,
    remoteUpper,
  );
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'REMOTE_VERSION_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull remote ${objType} ${objectName}`, {
      object: objectName,
      type: objType,
      nextSteps: [
        'Verify the object was transported to the remote system.',
        'Verify the remote system ID (RFC destination) is correct and reachable.',
      ],
      example: `abap pull ${objectName} --remote ${remoteUpper}`,
    });
  }

  const { source, version } = resp.data;
  const filename = buildFilename(objectName, objType, undefined, '.abap');
  const relPath = path.join(opts.dir, folderFor(objType), objectDirName(objectName), filename);
  const targetPath = path.resolve(process.cwd(), relPath);

  if (await fileExists(targetPath) && !opts.overwrite && !opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    throw new CliError('OVERWRITE_REQUIRED', `${outPath} already exists; use --overwrite to replace it`, {
      file: outPath,
      nextSteps: ['Re-run with --overwrite to replace the existing file.'],
      example: `abap pull ${objectName} --remote ${remoteUpper} --overwrite`,
    });
  }
  if (await fileExists(targetPath) && opts.skipExisting) {
    const outPath = toOutputPath(relPath);
    return {
      data: normalizePullData({
        object: objectName,
        type: objType,
        remote: remoteUpper,
        version,
        entries: [{ file: outPath, status: 'skipped' }],
        written: [],
        skipped: [outPath],
        failed: [],
      }),
      human: `Skipped ${objType} ${objectName} (file already exists: ${outPath})`,
    };
  }

  await writeAbapFile(targetPath, source);
  const outPath = toOutputPath(relPath);

  return {
    data: normalizePullData({
      object: objectName,
      type: objType,
      remote: remoteUpper,
      version,
      entries: [{ file: outPath, status: 'written' }],
      written: [outPath],
      skipped: [],
      failed: [],
    }),
    human: `Pulled ${objType} ${objectName} from ${remoteUpper} (version ${version}) to ${outPath}`,
  };
}