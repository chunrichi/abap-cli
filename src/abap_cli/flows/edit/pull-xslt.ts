/**
 * XSLT (transformation program) pull.
 *
 * Output is the abap-file-format pair:
 *   <rootDir>/<token>.xslt.json   ← AFF metadata (header.description/originalLanguage)
 *   <rootDir>/<token>.xslt.xml    ← source, line endings normalized
 *
 * The SAP read-back source always carries one more trailing line break than
 * what was written (`get_source_string()` joins the line table with CRLF);
 * `normalizeXsltSource()` removes it so the local pair never churns.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IcfClient } from '../../clients/icf-client.js';
import { CliError } from '../../output/json.js';
import type { ErrorCode } from '../../output/error-codes.js';
import { normalizePullData, toOutputPath } from '../../core/path-output.js';
import { normalizeXsltSource, sameXsltSource, wireToLocal, type XsltWireData } from '../../formats/xslt/json.js';
import { xsltPathsForObject, writeXsltPair } from '../../formats/xslt/companion.js';
import type { PullOptions, PullResult } from './pull-shared.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runPullXslt(objectName: string, opts: PullOptions): Promise<PullResult> {
  const name = objectName.trim().toUpperCase();
  const icf = await IcfClient.create();
  const nextSteps = [
    'Verify the transformation exists in the target system (SE80 → XSLT Programs).',
    'Create it with `abap create XSLT <name> --file <name>.xslt.json --package $TMP`.',
  ];
  let resp;
  try {
    resp = await icf.getXslt<XsltWireData>(name);
  } catch (error: unknown) {
    if (error instanceof CliError && error.code === 'XSLT_OBJECT_NOT_FOUND') {
      throw new CliError('OBJECT_NOT_FOUND', error.message, { object: name, type: 'XSLT', nextSteps });
    }
    throw error;
  }
  if (resp.status !== 'success' || !resp.data) {
    const rawCode = resp.error?.code ?? 'SAP_ERROR';
    const code: ErrorCode = rawCode === 'XSLT_OBJECT_NOT_FOUND' ? 'OBJECT_NOT_FOUND' : (rawCode as ErrorCode);
    throw new CliError(code, resp.error?.message ?? `Failed to pull XSLT ${name}`, {
      object: name,
      type: 'XSLT',
      nextSteps,
    });
  }

  const local = wireToLocal(resp.data);
  const paths = xsltPathsForObject(opts.dir, name);
  const jsonRel = path.relative(process.cwd(), paths.jsonPath);
  const xmlRel = path.relative(process.cwd(), paths.xmlPath);
  const outJson = toOutputPath(jsonRel);
  const outXml = toOutputPath(xmlRel);

  const jsonExists = await fileExists(paths.jsonPath);
  const xmlExists = await fileExists(paths.xmlPath);

  if (opts.skipExisting && jsonExists && xmlExists) {
    return {
      data: normalizePullData({
        object: name,
        type: 'XSLT',
        entries: [{ object: name, type: 'XSLT', status: 'skipped' }],
        written: [],
        skipped: [outJson, outXml],
        failed: [],
      }),
      human: `Skipped XSLT ${name} (pair already exists: ${outJson}, ${outXml})`,
    };
  }
  if (!opts.overwrite && (jsonExists || xmlExists)) {
    throw new CliError('OVERWRITE_REQUIRED', `${jsonExists ? outJson : outXml} already exists; use --overwrite to replace it`, {
      file: jsonExists ? outJson : outXml,
      nextSteps: ['Re-run with --overwrite to replace both files of the pair.'],
      example: `abap pull ${name} --type XSLT --overwrite`,
    });
  }

  await writeXsltPair(paths, local, resp.data.source);
  // Sanity: the written XML must read back to the same normalized source.
  const written = await fs.readFile(paths.xmlPath, 'utf8');
  if (!sameXsltSource(written, resp.data.source)) {
    throw new CliError('SAP_ERROR', `XSLT ${name} source did not round-trip through ${outXml}`, {
      object: name,
      type: 'XSLT',
      file: outXml,
    });
  }

  const sourceLength = normalizeXsltSource(resp.data.source).length;
  return {
    data: normalizePullData({
      object: name,
      type: 'XSLT',
      entries: [{ object: name, type: 'XSLT', status: 'written', files: [outJson, outXml] }],
      written: [outJson, outXml],
      skipped: [],
      failed: [],
      channel: 'icf',
      sourceLength,
    }),
    human: `Pulled XSLT ${name} to ${outJson} + ${outXml}`,
  };
}
