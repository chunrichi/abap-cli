import { AdtClientWrapper } from '../clients/adt-client.js';
import { IcfClient } from '../clients/icf-client.js';
import { CliError } from '../output/json.js';
import type { ErrorCode } from '../output/error-codes.js';
import { readAbapFile } from '../formats/abap-source.js';
import { parseTextpoolProperties, textpoolCategoryFromExtension } from '../formats/textpool.js';
import { routeTextpool } from '../textpool/textpool-router.js';
import type { PushStage } from './push-object.js';

interface TextpoolResolved {
  objectName: string;
  objectType: string;
  subtype: string;
}

/**
 * 014: push a single textpool .properties file via the mixed-mode route
 * (ADT text-elements API when the cached capability allows, otherwise the
 * self-built ICF /textpool endpoint). Route is decided from the recorded
 * profile — no runtime fallback (Q1).
 */
export async function pushTextpoolFile(
  client: AdtClientWrapper,
  resolved: TextpoolResolved,
  file: string,
  opts: { checkOnly?: boolean; activate?: boolean; dryRun?: boolean },
  onStage: (s: PushStage) => void,
): Promise<void> {
  if (opts.checkOnly) {
    throw new CliError('VALIDATION_ERROR', '--check-only is not supported for textpool files', {
      nextSteps: ['Textpool files are validated during push; drop --check-only.'],
    });
  }
  onStage('read');
  let content: string;
  try {
    content = await readAbapFile(file);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('FILE_PARSE_ERROR', `Cannot read ${file}: ${message}`, { details: { file } });
  }

  // subtype looks like "texts.en" → file category = first segment.
  // Validate it via textpoolCategoryFromExtension (throws on unknown) then keep
  // both the file name ('texts') and the ADT name ('symbols').
  const rawFileCat = resolved.subtype.split('.')[0] ?? '';
  const adtCat = textpoolCategoryFromExtension(rawFileCat);
  const fileCat = rawFileCat as 'texts' | 'selections' | 'headings';

  // Mixed-mode route: read the cached capability and pick ADT/ICF directly.
  const { loadConfig } = await import('../config/project-config.js');
  const cfg = await loadConfig();
  const route = routeTextpool(cfg.systemName, 'write');
  onStage(route === 'adt' ? 'textpool-adt' : 'textpool-icf');

  if (opts.dryRun) return; // plan only — no mutating call

  if (route === 'adt') {
    const elements = parseTextpoolProperties(fileCat, content);
    const lock = await client.lock(`/sap/bc/adt/textelements/programs/${resolved.objectName.toLowerCase()}`);
    try {
      await client.setTextElements(resolved.objectType, resolved.objectName, adtCat, elements, lock.LOCK_HANDLE ?? '', cfg.transport || undefined);
    } finally {
      try {
        await client.unLock(`/sap/bc/adt/textelements/programs/${resolved.objectName.toLowerCase()}`, lock.LOCK_HANDLE ?? '');
      } catch {
        // best-effort unlock; warning surfaces separately
      }
    }
    return;
  }

  // ICF route: POST /textpool/<category>?object=<name>&type=<type>
  // (the endpoint uses the .properties file category name: texts|selections|headings)
  const elements = parseTextpoolProperties(fileCat, content);
  const icf = await IcfClient.create();
  const resp = await icf.postTextpool<{ written?: number }>(fileCat, resolved.objectName, resolved.objectType, { elements });
  if (resp.status !== 'success') {
    throw new CliError((resp.error?.code as ErrorCode | undefined) ?? 'SAP_ERROR', resp.error?.message ?? 'textpool write failed');
  }
}
