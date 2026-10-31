/**
 * VIEW (DDIC database view) push via the ICF `/ddic/view` route.
 *
 * Like the other DDIC types, `push --file` probes the object first
 * (`GET /ddic/view/<name>`) so push stays update-only; `create` is the only
 * path that may create an object. Full-write semantics: the whole view
 * definition is replaced through `RS_CORR_INSERT` + `DDIF_VIEW_PUT` +
 * `DDIF_VIEW_ACTIVATE` on the SAP side.
 */
import * as path from 'node:path';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { resolveTransport } from '../../core/transport.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import { resolveFile } from '../../formats/file-resolver.js';
import { viewArtifact, type ViewLocal } from '../../formats/view/json.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';

/** Read + validate a view-v1 JSON file (shared with the `--atomic` phase-1 gate). */
async function readValidatedView(file: string, objectName: string): Promise<ViewLocal> {
  const outFile = toRelativeOutputPath(file);
  try {
    return await viewArtifact.load(path.resolve(process.cwd(), file));
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    throw new CliError('INVALID_ARGUMENT', `Cannot read VIEW file ${outFile}: ${error instanceof Error ? error.message : String(error)}`, {
      file: outFile,
      type: 'VIEW',
      object: objectName,
      nextSteps: ['Verify the file exists and is a valid view-v1 JSON document.'],
    });
  }
}

/** `--atomic` phase-1 wrapper: validate only, discard the parsed payload. */
export async function validateViewFile(file: string): Promise<void> {
  await readValidatedView(file, resolveFile(file).objectName);
}

export async function pushViewFile(
  client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const local = await readValidatedView(file, resolved.objectName);
  const objectName = resolved.objectName.toUpperCase();

  const wire = viewArtifact.toWire(local);
  wire.name = objectName;
  // Transport: --tr > config > file's recorded package rule > user's open request.
  const packageName = (wire.package ?? '').toUpperCase();
  let transport = opts.tr ?? client.getConfig().transport ?? '';
  if (!transport && packageName !== '$TMP') {
    transport = await resolveTransport(client, opts.tr, client.getConfig().transport);
  }
  wire.transportRequest = transport || undefined;

  const icf = await IcfClient.create();
  // push updates existing objects only.
  const head = await icf.getDdic<Record<string, unknown>>('view', objectName);
  if (head.status !== 'success' || !head.data) {
    const outFile = toRelativeOutputPath(file);
    if (head.error?.code === 'DDIC_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `VIEW ${objectName} does not exist; push updates existing views only`, {
        object: objectName,
        type: 'VIEW',
        file: outFile,
        nextSteps: [
          `Create it first: abap create VIEW ${objectName} --file ${outFile} --package <package> --yes`,
          'Then push again to update the view.',
        ],
        example: `abap push ${outFile}`,
      });
    }
    throw new CliError((head.error?.code ?? 'SAP_ERROR') as ErrorCode, head.error?.message ?? `Failed to check whether VIEW ${objectName} exists`, {
      object: objectName,
      type: 'VIEW',
      file: outFile,
    });
  }

  const resp = await icf.postDdic<{ name: string; type: string; action: 'created' | 'updated' }>('view', wire);
  if (resp.status !== 'success' || !resp.data) {
    const code = (resp.error?.code ?? 'VIEW_WRITE_FAILED') as ErrorCode;
    throw new CliError(code, resp.error?.message ?? `Failed to push VIEW ${objectName}`, {
      object: objectName,
      type: 'VIEW',
      details: resp.error?.details,
      nextSteps: ['Fix the cause above and re-run.'],
    });
  }
  return { transport, status: 'written' };
}
