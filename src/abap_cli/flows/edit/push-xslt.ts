/**
 * XSLT (transformation program) push.
 *
 * Push is update-only (like DDIC / TRAN): the transformation must already
 * exist; creating one goes through `abap create XSLT --file`.
 *
 * The input can be either side of the AFF pair — `<name>.xslt.json` or its
 * `<name>.xslt.xml` companion — because both resolve to the same object. The
 * metadata JSON is validated against `xslt-v1.json` and the source is read from
 * the XML companion before the ICF POST.
 */
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { toRelativeOutputPath } from '../../core/path-output.js';
import { localToWire } from '../../formats/xslt/json.js';
import { readXsltPair, xsltPairPaths } from '../../formats/xslt/companion.js';
import type { JsonPushTarget, PushFileOptions, PushOneResult } from './push-types.js';

export async function pushXsltFile(
  client: AdtClientWrapper,
  resolved: JsonPushTarget,
  file: string,
  opts: PushFileOptions,
): Promise<PushOneResult> {
  const { local, source } = await readXsltPair(file);
  const outFile = toRelativeOutputPath(file);
  const outJson = toRelativeOutputPath(xsltPairPaths(file).jsonPath);

  const icf = await IcfClient.create();
  const createHint = [
    `Create it first: abap create XSLT ${resolved.objectName} --file ${outJson} --package <package> --yes`,
    'Then push again to update the transformation source.',
  ];
  let probe;
  try {
    probe = await icf.getXslt<{ name: string }>(resolved.objectName);
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'XSLT_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `XSLT ${resolved.objectName} does not exist; push updates existing objects only`, {
        object: resolved.objectName,
        type: 'XSLT',
        file: outFile,
        nextSteps: createHint,
        example: `abap push ${outJson} --yes`,
      });
    }
    throw error;
  }
  if (probe.status !== 'success' || !probe.data) {
    if (probe.error?.code === 'XSLT_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', `XSLT ${resolved.objectName} does not exist; push updates existing objects only`, {
        object: resolved.objectName,
        type: 'XSLT',
        file: outFile,
        nextSteps: createHint,
        example: `abap push ${outJson} --yes`,
      });
    }
    const rawCode = (probe.error?.code ?? 'SAP_ERROR') as ErrorCode;
    throw new CliError(rawCode, probe.error?.message ?? `Failed to read XSLT ${resolved.objectName}`, {
      object: resolved.objectName,
      type: 'XSLT',
      file: outFile,
    });
  }

  // Non-$TMP updates need a transport request; fall back to the project config
  // transport like the other ICF artifact pushes.
  const transport = opts.tr ?? client.getConfig().transport ?? '';
  const wire = localToWire(local, source, {
    name: resolved.objectName,
    transportRequest: transport,
  });
  const resp = await icf.postXslt<{ name: string; action: string }>(resolved.objectName, wire);
  if (resp.status !== 'success' || !resp.data) {
    throw new CliError((resp.error?.code ?? 'XSLT_PUSH_FAILED') as ErrorCode, resp.error?.message ?? `Failed to push XSLT ${resolved.objectName}`, {
      object: resolved.objectName,
      type: 'XSLT',
      details: resp.error?.details,
      file: outFile,
      nextSteps: ['Fix the cause above and re-run.'],
    });
  }
  return { transport, status: 'written' };
}

/** Local structural validation used by `abap push --atomic`. */
export async function validateXsltFile(file: string): Promise<void> {
  await readXsltPair(file);
}
