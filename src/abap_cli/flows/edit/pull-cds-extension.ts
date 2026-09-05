/**
 * DCLS / DDLX / DDLA pull — three CDS companion types share the
 * `sourceObjectStrategy()` flow with the `.acds` extension. The only
 * differences between them are:
 *   - the type code (`DCLS` / `DDLX` / `DDLA`)
 *   - the ADT object URL prefix
 *   - the AFF folder under rootDir
 *
 * Each `runPull<Type>One` function is a thin wrapper around the shared
 * `runPullCdsExtension` helper.
 */
import { AdtClientWrapper } from '../../clients/adt-client.js';
import { pullObject } from './pull-source.js';
import { folderFor } from '../../formats/type-folder.js';

export type CdsExtensionType = 'DCLS' | 'DDLX' | 'DDLA';

export interface PullCdsExtensionOptions {
  profile?: { kernelRelease?: string };
  rootDir?: string;
  type?: string;
  package?: string;
  tr?: string;
  dir?: string;
  overwrite?: boolean;
  skipExisting?: boolean;
  includeTests?: boolean;
  includeAllParts?: boolean;
  limit?: string;
  page?: string;
  textpool?: boolean;
  remote?: string;
}

export interface PullCdsExtensionResult {
  object: string;
  files: string[];
}

/** ADT object URL prefix per CDS extension type. */
const ADT_PREFIX: Record<CdsExtensionType, string> = {
  DCLS: '/sap/bc/adt/dcls/dc',
  DDLX: '/sap/bc/adt/ddlx/extensions',
  DDLA: '/sap/bc/adt/ddla/annotations',
};

/**
 * Pull a single CDS extension object. The `.json` and `.acds` files are
 * written under `<rootDir>/<folderFor(type)>/<lower>/` (e.g.
 * `dcls/zmy_dcls/zmy_dcls.dcls.json`).
 */
export async function runPullCdsExtension(
  type: CdsExtensionType,
  name: string,
  opts: PullCdsExtensionOptions = {},
): Promise<PullCdsExtensionResult> {
  const lower = name.toLowerCase();
  const client = await AdtClientWrapper.create();
  const object = {
    name: name.toUpperCase(),
    type,
    objectUrl: `${ADT_PREFIX[type]}/${lower}`,
  };
  const result = await pullObject(client, object, {
    ...(opts.dir ? { dir: opts.dir } : { dir: opts.rootDir ?? process.cwd() }),
    overwrite: opts.overwrite,
    skipExisting: opts.skipExisting,
  });
  const expectedFolder = folderFor(type);
  for (const f of result.written) {
    if (!f.includes(`/${expectedFolder}/${lower}/`)) {
      throw new Error(`${type} file landed outside the expected folder: ${f}`);
    }
  }
  return { object: object.name, files: result.written };
}

export function runPullDcls(
  name: string,
  opts: PullCdsExtensionOptions = {},
): Promise<PullCdsExtensionResult> {
  return runPullCdsExtension('DCLS', name, opts);
}

export function runPullDdlx(
  name: string,
  opts: PullCdsExtensionOptions = {},
): Promise<PullCdsExtensionResult> {
  return runPullCdsExtension('DDLX', name, opts);
}

export function runPullDdla(
  name: string,
  opts: PullCdsExtensionOptions = {},
): Promise<PullCdsExtensionResult> {
  return runPullCdsExtension('DDLA', name, opts);
}

export function isCdsExtensionType(t: string): t is CdsExtensionType {
  const u = t.toUpperCase();
  return u === 'DCLS' || u === 'DDLX' || u === 'DDLA';
}
