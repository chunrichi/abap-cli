import type { AtcWorkList } from 'abap-adt-api';
import type { AdtClientWrapper } from '../clients/adt-client.js';
import type { CheckIssue } from '../output/issues.js';

export interface AtcRunOptions {
  variant: string;
  mainUrl: string;
  /** Local file path attached to every issue (FR-008 `file` field). */
  file: string;
}

export interface AtcCheckResult {
  issues: CheckIssue[];
  /** Raw SAP worklist, persisted verbatim by `check --out` (FR-0xx). */
  worklist: AtcWorkList;
}

/**
 * Run an ATC check for one object and map findings to the unified CheckIssue
 * shape (FR-011, research §5). The raw worklist is returned alongside so the
 * caller can persist the full findings when the volume is large.
 */
export async function runAtcCheck(
  client: AdtClientWrapper,
  opts: AtcRunOptions,
): Promise<AtcCheckResult> {
  await client.atcCheckVariant(opts.variant);
  const run = await client.createAtcRun(opts.variant, opts.mainUrl);
  const worklist = await client.atcWorklists(run.id, run.timestamp, undefined, true);
  const issues: CheckIssue[] = [];
  for (const object of worklist.objects) {
    for (const finding of object.findings) {
      issues.push({
        file: opts.file,
        line: finding.location.range.start.line,
        severity: priorityToSeverity(finding.priority),
        code: finding.checkId,
        message: finding.messageTitle,
      });
    }
  }
  return { issues, worklist };
}

function priorityToSeverity(priority: number): 'info' | 'warning' | 'error' {
  if (priority === 1) return 'error';
  if (priority === 2) return 'warning';
  return 'info';
}
