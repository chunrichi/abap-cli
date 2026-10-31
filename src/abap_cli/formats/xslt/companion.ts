/**
 * XSLT two-file companion layout: `<name>.xslt.json` + `<name>.xslt.xml`.
 *
 * The JSON is the AFF metadata document; the XML is the transformation source
 * (`CL_O2_API_XSLTDESC->get_source_string()`). Neither file is meaningful
 * without the other: create/push read both, pull writes both.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CliError } from '../../output/json.js';
import { toOutputPath } from '../../core/path-output.js';
import { affObjectToken } from '../file-resolver.js';
import {
  normalizeXsltSource,
  xsltArtifact,
  xsltSourceFileContent,
  type XsltLocal,
} from './json.js';

/** Resolved pair of absolute paths for one transformation. */
export interface XsltPairPaths {
  /** Absolute path of the `.xslt.json` metadata document. */
  jsonPath: string;
  /** Absolute path of the `.xslt.xml` source file. */
  xmlPath: string;
}

/** Path pair for a local file that is either side of the XSLT pair. */
export function xsltPairPaths(filePath: string): XsltPairPaths {
  const abs = path.resolve(process.cwd(), filePath);
  if (abs.endsWith('.xslt.json')) {
    return { jsonPath: abs, xmlPath: abs.replace(/\.xslt\.json$/, '.xslt.xml') };
  }
  if (abs.endsWith('.xslt.xml')) {
    return { jsonPath: abs.replace(/\.xslt\.xml$/, '.xslt.json'), xmlPath: abs };
  }
  throw new CliError('FILE_PARSE_ERROR', `Not an XSLT file: ${toOutputPath(filePath)}`, {
    file: toOutputPath(filePath),
    nextSteps: ['XSLT files follow the abap-file-format pair <name>.xslt.json + <name>.xslt.xml.'],
  });
}

/** Pair paths for an object written under `dir` (pull output). */
export function xsltPathsForObject(dir: string, objectName: string): XsltPairPaths {
  const token = affObjectToken(objectName);
  const root = path.resolve(process.cwd(), dir);
  return {
    jsonPath: path.join(root, `${token}.xslt.json`),
    xmlPath: path.join(root, `${token}.xslt.xml`),
  };
}

/** Force a pair path set for an object name (create from an explicit JSON path). */
export function xsltPathsForJsonFile(jsonFilePath: string): XsltPairPaths {
  const abs = path.resolve(process.cwd(), jsonFilePath);
  return { jsonPath: abs, xmlPath: abs.replace(/\.xslt\.json$/, '.xslt.xml') };
}

export interface XsltPair {
  local: XsltLocal;
  source: string;
  paths: XsltPairPaths;
}

/**
 * Read + validate the metadata JSON and its companion XML source.
 *
 * The XML is not schema-validated (it is not an AFF JSON document); an empty
 * source is rejected here so a half-authored pair fails locally instead of
 * reaching SAP as an activation error.
 */
export async function readXsltPair(filePath: string): Promise<XsltPair> {
  const paths = xsltPairPaths(filePath);
  let local: XsltLocal;
  try {
    local = await xsltArtifact.read(paths.jsonPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('INVALID_ARGUMENT', `Cannot read XSLT metadata ${toOutputPath(paths.jsonPath)}: ${message}`, {
      file: toOutputPath(paths.jsonPath),
      nextSteps: ['Verify the file exists and contains valid JSON.'],
    });
  }

  const errors = await xsltArtifact.validate(local);
  if (errors.length > 0) {
    throw new CliError('VALIDATION_ERROR', `Invalid XSLT metadata in ${toOutputPath(paths.jsonPath)}: ${errors.join('; ')}`, {
      file: toOutputPath(paths.jsonPath),
      type: 'XSLT',
      details: errors,
      nextSteps: ['Fix the header fields and re-run (schema: xslt-v1.json).'],
    });
  }

  let rawSource: string;
  try {
    rawSource = await fs.readFile(paths.xmlPath, 'utf8');
  } catch {
    throw new CliError('VALIDATION_ERROR', `XSLT companion file missing: ${toOutputPath(paths.xmlPath)}`, {
      file: toOutputPath(paths.xmlPath),
      nextSteps: [
        'Both files are required: <name>.xslt.json (metadata) and <name>.xslt.xml (source).',
        'Run `abap pull <name> --type XSLT` to regenerate the pair, or add the XML source file.',
      ],
    });
  }
  const source = normalizeXsltSource(rawSource);
  if (source.trim() === '') {
    throw new CliError('VALIDATION_ERROR', `XSLT companion file is empty: ${toOutputPath(paths.xmlPath)}`, {
      file: toOutputPath(paths.xmlPath),
      nextSteps: ['Write the XSLT program source into the .xslt.xml companion file.'],
    });
  }
  return { local, source, paths };
}

/** Write the pair (normalising the XML source). */
export async function writeXsltPair(
  paths: XsltPairPaths,
  local: XsltLocal,
  source: string,
): Promise<void> {
  await xsltArtifact.write(paths.jsonPath, local);
  await fs.mkdir(path.dirname(paths.xmlPath), { recursive: true });
  await fs.writeFile(paths.xmlPath, xsltSourceFileContent(source), 'utf8');
}
