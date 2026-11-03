/**
 * JOBD (application job definition) local-file ↔ ICF wire mapping.
 *
 * JOBD has no AFF format in upstream abap-file-formats and no ADT resource on
 * the supported releases, so the document is a local extension validated by
 * `jobd-v1.json`. The shape mirrors `CL_JR_JOB_DEFINITION=>TY_JOB_DEFINITION`
 * (STJR_JOBD_ROOT + STJR_JOBD_TREP as serialized by abapGit), with the
 * server-managed fields removed:
 *
 *   - `name` / `package` are TADIR metadata; `package` is read-side only and
 *     travels as a request parameter on create/push/delete.
 *   - `owner`, `btcjobUser`, `created*`, `changed*` are set by SAP.
 *
 * Wire: the document itself is posted to `/jobd/<name>`; the package and the
 * transport request are query parameters.
 */
import { validateAff } from '../../aff/schema-validator.js';
import { defineWireArtifact } from '../artifact.js';

/** JR_JDNAME is CHAR 32. */
export const JOB_DEFINITION_NAME_MAX_LENGTH = 32;

/** ABAP CHAR1 indicator as serialized by the ICF service. */
export type Indicator = '' | 'X';

export interface JobdLocal {
  formatVersion: '1';
  name: string;
  /** TADIR package (read-side only; create/push take it from the command line). */
  package?: string;
  btcjobName?: string;
  prodClient?: Indicator;
  sysClient?: Indicator;
  maintMode?: Indicator;
  isScope?: Indicator;
  maxRuntime?: number;
  abortionCode?: string;
  isTimeBased?: Indicator;
  isEventBased?: Indicator;
  startTime?: string;
  startWeekday?: number;
  startMonthday?: number;
  beginMonth?: Indicator;
  endMonth?: Indicator;
  recurCode?: string;
  recurValue?: number;
  eventName?: string;
  eventParam?: string;
  isLight?: Indicator;
  jdType?: string;
  timezoneIndicator?: string;
  scopeClass?: string;
  schedulingConditions?: string;
  alwaysRun?: Indicator;
  techClntRun?: Indicator;
  noRandomStarttime?: Indicator;
  isScopeChanged?: Indicator;
  passClient?: boolean;
  sysTimezoneIndicator?: boolean;
  reportName?: string;
  variantName?: string;
  localDeact?: boolean;
  localCust?: boolean;
}

/** Wire payload accepted by ICF `/jobd/<name>` (the document itself). */
export type JobdWire = Omit<JobdLocal, 'package'>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asUpperText(value: unknown): string {
  return asText(value).toUpperCase();
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asIndicator(value: unknown): Indicator {
  return value === 'X' || value === 'x' ? 'X' : '';
}

function asBool(value: unknown): boolean {
  return value === true || value === 'X' || value === 'x';
}

/** Convert the ICF GET payload into the local jobd-v1 document. */
export function wireToLocal(wire: unknown): JobdLocal {
  const w = asRecord(wire) ?? {};
  const local: JobdLocal = {
    formatVersion: '1',
    name: asUpperText(w.name),
  };
  const packageName = asUpperText(w.package);
  if (packageName) local.package = packageName;

  const text = (key: string, upper = false): string => {
    const value = asText(w[key]);
    return upper ? value.toUpperCase() : value;
  };
  const indicator = (key: string): Indicator => asIndicator(w[key]);

  local.btcjobName = text('btcjobName', true);
  local.prodClient = indicator('prodClient');
  local.sysClient = indicator('sysClient');
  local.maintMode = indicator('maintMode');
  local.isScope = indicator('isScope');
  local.maxRuntime = asInt(w.maxRuntime, 0);
  local.abortionCode = text('abortionCode', true);
  local.isTimeBased = indicator('isTimeBased');
  local.isEventBased = indicator('isEventBased');
  local.startTime = text('startTime');
  local.startWeekday = asInt(w.startWeekday, 0);
  local.startMonthday = asInt(w.startMonthday, 0);
  local.beginMonth = indicator('beginMonth');
  local.endMonth = indicator('endMonth');
  local.recurCode = text('recurCode', true);
  local.recurValue = asInt(w.recurValue, 0);
  local.eventName = text('eventName');
  local.eventParam = text('eventParam');
  local.isLight = indicator('isLight');
  local.jdType = text('jdType', true);
  local.timezoneIndicator = text('timezoneIndicator', true);
  local.scopeClass = text('scopeClass', true);
  local.schedulingConditions = text('schedulingConditions');
  local.alwaysRun = indicator('alwaysRun');
  local.techClntRun = indicator('techClntRun');
  local.noRandomStarttime = indicator('noRandomStarttime');
  local.isScopeChanged = indicator('isScopeChanged');
  local.passClient = asBool(w.passClient);
  local.sysTimezoneIndicator = asBool(w.sysTimezoneIndicator);
  local.reportName = text('reportName', true);
  local.variantName = text('variantName', true);
  local.localDeact = asBool(w.localDeact);
  local.localCust = asBool(w.localCust);
  return local;
}

/** Convert the local document into the body ICF `/jobd/<name>` accepts. */
export function localToWire(local: JobdLocal): JobdWire {
  const { package: _package, ...wire } = wireToLocal(local);
  wire.name = local.name.trim().toUpperCase();
  return wire;
}

/**
 * Semantic validation beyond JSON Schema: the name rules the ICF route itself
 * enforces, so a bad file fails locally with an actionable message.
 */
export function validateJobdObject(doc: unknown): string[] {
  const data = asRecord(doc);
  if (!data) return ['jobd document must be a JSON object'];
  const errors: string[] = [];

  const rawName = asText(data.name);
  const name = rawName.toUpperCase();
  if (!name) {
    errors.push('Missing required field: name (e.g. { "name": "ZCLI_TC_JOBD_DAILY", ... })');
  } else {
    if (name.length > JOB_DEFINITION_NAME_MAX_LENGTH) {
      errors.push(`name must not exceed ${JOB_DEFINITION_NAME_MAX_LENGTH} characters (got ${name.length})`);
    }
    if (!/^[A-Z0-9_/]+$/.test(name)) {
      errors.push(`name must contain only A-Z, 0-9, _ and / (got "${rawName}")`);
    }
  }

  for (const key of ['passClient', 'sysTimezoneIndicator', 'localDeact', 'localCust'] as const) {
    const value = data[key];
    if (value !== undefined && typeof value !== 'boolean') {
      errors.push(`${key} must be a boolean`);
    }
  }

  const startTime = asText(data.startTime);
  if (startTime && !/^\d{2}:\d{2}:\d{2}$/.test(startTime)) {
    errors.push('startTime must use the ISO time notation HH:MM:SS (e.g. "06:00:00")');
  }

  return errors;
}

/** Agent-facing minimal jobd-v1 example (`abap create --schema JOBD`). */
export function getJobdJsonExample(): string {
  return `# src/zcli_tc_jobd_daily.jobd.json (single file)
{
  "formatVersion": "1",
  "name": "ZCLI_TC_JOBD_DAILY",
  "btcjobName": "ZCLI_TC_JOBD_DAILY",
  "isTimeBased": "X",
  "startTime": "06:00:00",
  "recurCode": "D",
  "recurValue": 1,
  "reportName": "ZCLI_TC_REPORT",
  "variantName": ""
}
# Time-based definitions need isTimeBased "X" + startTime/recurCode; event-based
# ones use isEventBased "X" + eventName. reportName/variantName point at the
# report variant the job runs.`;
}

/** JOBD artifact: file/schema plumbing + local ↔ ICF wire mapping. */
export const jobdArtifact = defineWireArtifact<JobdLocal, JobdWire>({
  type: 'JOBD',
  toWire: (local) => localToWire(local),
  fromWire: (wire) => wireToLocal(wire),
  validate: async (doc) => {
    const result = await validateAff('JOBD', doc);
    const schemaErrors =
      result.status === 'pass' || result.status === 'warn'
        ? []
        : result.errors.map((e) => `${e.instancePath || '/'}: ${e.message}`);
    return [...schemaErrors, ...validateJobdObject(doc)];
  },
});
