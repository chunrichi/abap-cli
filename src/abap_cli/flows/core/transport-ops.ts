import { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { resolveObject, getObjectParts } from '../../core/resolve.js';

export interface TransportObjectInfo {
  name: string;
  type: string;
  status: string;
  /**
   * SAP user that owns this object's task — for direct objects this is the
   * transport owner; for objects inside a task, the task owner. Optional
   * because `transportDetails` only emits the field on tasks (the SAP XML
   * schema has no per-object `tm:owner`); absent → caller cannot filter.
   */
  owner?: string;
}

export interface TransportTaskInfo {
  number: string;
  description: string;
  status: string;
  owner: string;
  objects: TransportObjectInfo[];
}

export interface TransportRequestInfo {
  number: string;
  description: string;
  status: string;
  owner: string;
  objects: TransportObjectInfo[];
  tasks: TransportTaskInfo[];
  deduplicated: number;
}

export interface TransportAssignResult {
  object: string;
  transport: string;
  assigned: boolean;
}

export interface TransportResolveResult {
  object: string;
  transports: { number: string; status: string; owner: string; text: string }[];
}

interface RawTransportObject {
  'tm:name': string;
  'tm:type': string;
  'tm:obj_info'?: string;
}

interface RawTransportTask {
  'tm:number'?: string;
  'tm:desc'?: string;
  'tm:status'?: string;
  'tm:owner'?: string;
  objects?: RawTransportObject[];
}

interface RawTransportDetails {
  'tm:number': string;
  'tm:desc': string;
  'tm:status': string;
  'tm:owner': string;
  objects?: RawTransportObject[];
  tasks?: RawTransportTask[];
}

function toObjectInfo(o: RawTransportObject, owner: string): TransportObjectInfo {
  return {
    name: o['tm:name'],
    type: o['tm:type'],
    status: o['tm:obj_info'] ?? '',
    owner: owner || undefined,
  };
}

function toTaskInfo(t: RawTransportTask): TransportTaskInfo {
  const taskOwner = t['tm:owner'] ?? '';
  return {
    number: t['tm:number'] ?? '',
    description: t['tm:desc'] ?? '',
    status: t['tm:status'] ?? '',
    owner: taskOwner,
    objects: (t.objects ?? []).map((o) => toObjectInfo(o, taskOwner)),
  };
}

/** Collect every object reference across the request and its nested tasks. */
function collectAllReferences(details: RawTransportDetails): TransportObjectInfo[] {
  const transportOwner = details['tm:owner'] ?? '';
  const direct = (details.objects ?? []).map((o) => toObjectInfo(o, transportOwner));
  const fromTasks = (details.tasks ?? []).flatMap((t) => (t.objects ?? []).map((o) => toObjectInfo(o, t['tm:owner'] ?? transportOwner)));
  return [...direct, ...fromTasks];
}

/** Structured metadata for `transport show <req>`. */
export async function showTransport(client: AdtClientWrapper, number: string): Promise<TransportRequestInfo> {
  try {
    const details = (await client.transportDetails(number)) as RawTransportDetails;
    const transportOwner = details['tm:owner'] ?? '';
    const directObjects = (details.objects ?? []).map((o) => toObjectInfo(o, transportOwner));
    const tasks = (details.tasks ?? []).map(toTaskInfo);
    const references = collectAllReferences(details);
    const deduplicated = references.length - directObjects.length;
    return {
      number: details['tm:number'],
      description: details['tm:desc'],
      status: details['tm:status'],
      owner: details['tm:owner'],
      objects: directObjects,
      tasks,
      deduplicated,
    };
  } catch (error: unknown) {
    throw mapTransportError(error, number);
  }
}

/** Which request(s) an object currently belongs to — read-only. */
export async function resolveObjectTransport(
  client: AdtClientWrapper,
  objectName: string,
): Promise<TransportResolveResult> {
  const object = await resolveObject(client, objectName);
  const parts = await getObjectParts(client, object);
  const mainUrl = (parts.find((p) => p.subtype === 'main') ?? parts[0]!).sourceUrl;
  const info = await client.transportInfo(mainUrl);
  const transports = (info.TRANSPORTS ?? []).map((t) => ({
    number: t.TRKORR,
    status: t.TRSTATUS,
    owner: t.AS4USER,
    text: t.AS4TEXT,
  }));
  return { object: object.name, transports };
}

/**
 * Attach an object to a transport by writing its current source back with the
 * target transport as corrNr. Already-assigned → no-op.
 */
export async function assignObjectToTransport(
  client: AdtClientWrapper,
  objectName: string,
  transport: string,
): Promise<TransportAssignResult> {
  const object = await resolveObject(client, objectName);
  const parts = await getObjectParts(client, object);
  const mainPart = parts.find((p) => p.subtype === 'main') ?? parts[0]!;
  const content = await client.getObjectSource(mainPart.sourceUrl);

  // Already assigned to the target transport → report a no-op.
  const info = await client.transportInfo(mainPart.sourceUrl);
  if ((info.TRANSPORTS ?? []).some((t) => t.TRKORR === transport)) {
    return { object: object.name, transport, assigned: false };
  }

  let lockHandle: string | undefined;
  try {
    const lock = await client.lock(object.objectUrl);
    lockHandle = lock.LOCK_HANDLE;
    await client.setObjectSource(mainPart.sourceUrl, content, lockHandle, transport);
  } catch (error: unknown) {
    throw mapAssignError(error, object.name, transport);
  } finally {
    if (lockHandle) {
      try {
        await client.unLock(object.objectUrl, lockHandle);
      } catch {
        // Unlock failure after a successful assign is a warning, not a failure.
      }
    }
  }
  return { object: object.name, transport, assigned: true };
}

function mapTransportError(error: unknown, number: string): never {
  if (error instanceof CliError && error.code === 'SAP_ERROR' && error.details?.httpStatus === 404) {
    throw new CliError('NOT_FOUND', `Transport request ${number} not found`, {
      nextSteps: ["List your requests: 'abap transport list'", "Create one: 'abap transport create <description>'"],
      example: 'abap transport show NDK123456',
    });
  }
  if (error instanceof CliError && error.code === 'SAP_ERROR' && error.details?.httpStatus === 403) {
    throw new CliError('LOCKED', `Transport request ${number} is not modifiable`, {
      nextSteps: ['Pick an open (modifiable) request: abap transport list --open'],
      example: 'abap transport show TRN001',
    });
  }
  throw error;
}

function mapAssignError(error: unknown, object: string, transport: string): never {
  if (error instanceof CliError && error.code === 'SAP_ERROR' && error.details?.httpStatus === 403) {
    throw new CliError('LOCKED', `Cannot assign ${object}: the object or transport is locked`, {
      object,
      transport,
      nextSteps: ['Confirm the object is not locked by another user.', 'Confirm the transport is modifiable: abap transport list --open'],
    });
  }
  throw error;
}

export interface TransportEntry {
  number: string;
  description: string;
  status: string;
  owner: string;
}

export interface TransportListData {
  workbench: TransportEntry[];
  customizing: TransportEntry[];
}

/** Flow outcome: JSON envelope data + human summary, printed by the command layer. */
export interface TransportEnvelope<T> {
  data: T;
  human: string;
}

export interface TransportCreateResult {
  transport: string | null;
  description: string;
  package: string;
  dryRun?: boolean;
  ref?: string;
}

export interface TransportCreateOptions {
  package?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface TransportAssignOptions {
  tr: string;
  dryRun?: boolean;
  yes?: boolean;
}

export async function runTransportList(openOnly: boolean): Promise<TransportEnvelope<TransportListData>> {
  const client = await AdtClientWrapper.create();
  const user = client.getConfig().sap.username;
  const result = await client.userTransports(user);

  const toEntries = (requests: { 'tm:number': string; 'tm:desc': string; 'tm:status': string; 'tm:owner': string }[]) =>
    requests.map((r) => ({
      number: r['tm:number'],
      description: r['tm:desc'],
      status: r['tm:status'],
      owner: r['tm:owner'],
    }));

  const collect = (targets: typeof result.workbench, open: boolean) => {
    const out: TransportEntry[] = [];
    for (const target of targets) {
      out.push(...toEntries(open ? target.modifiable : [...target.modifiable, ...target.released]));
    }
    return out;
  };

  const data: TransportListData = {
    workbench: collect(result.workbench, openOnly),
    customizing: collect(result.customizing, openOnly),
  };
  return { data, human: formatList(data) };
}

export async function runTransportCreate(
  description: string,
  opts: TransportCreateOptions = {},
): Promise<TransportEnvelope<TransportCreateResult>> {
  if (!description.trim()) {
    throw new CliError('INVALID_ARGUMENT', 'Transport description must not be empty');
  }
  if (!opts.dryRun && !opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', 'transport create is a write operation; confirm with --yes or pass --dry-run.', {
      nextSteps: [
        'Re-run with --yes to actually create the transport.',
        'Or pass --dry-run to preview the request without creating it.',
      ],
      example: 'abap transport create "<description>" --yes',
    });
  }
  const devClass = (opts.package || '$TMP').trim().toUpperCase();
  // A standalone request (no object context) references a package URL as REF.
  const ref = `/sap/bc/adt/packages/${encodeURIComponent(devClass)}`;

  if (opts.dryRun) {
    return {
      data: { transport: null, description: description.trim(), package: devClass, dryRun: true, ref },
      human: `Would create transport request in ${devClass} (dry-run)`,
    };
  }

  const client = await AdtClientWrapper.create();
  let transport: string;
  try {
    transport = await client.createTransport(ref, description.trim(), devClass);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('TRANSPORT_CREATE_FAILED', `Failed to create transport request: ${message}`);
  }
  return {
    data: { transport, description: description.trim(), package: devClass },
    human: `Created transport request ${transport} (${devClass})`,
  };
}

export async function runTransportShow(req: string): Promise<TransportEnvelope<TransportRequestInfo>> {
  const client = await AdtClientWrapper.create();
  const data = await showTransport(client, req);
  return { data, human: formatShow(data) };
}

export async function runTransportResolve(object: string): Promise<TransportEnvelope<TransportResolveResult>> {
  const client = await AdtClientWrapper.create();
  const data = await resolveObjectTransport(client, object);
  return { data, human: formatResolve(data) };
}

export async function runTransportAssign(
  object: string,
  opts: TransportAssignOptions,
): Promise<TransportEnvelope<TransportAssignResult & { dryRun?: boolean }>> {
  if (!process.stdin.isTTY && !opts.dryRun && !opts.yes) {
    throw new CliError('VALIDATION_ERROR', 'transport assign is a write operation; confirm with --yes or pass --dry-run.', {
      nextSteps: [
        'Re-run with --yes to actually attach the object to the transport.',
        'Or pass --dry-run to preview the assign without writing.',
      ],
      example: 'abap transport assign <object> --tr <transport> --yes',
    });
  }

  if (opts.dryRun) {
    return {
      data: { object, transport: opts.tr, assigned: false, dryRun: true },
      human: `Would attach ${object} to transport ${opts.tr} (dry-run)`,
    };
  }

  const client = await AdtClientWrapper.create();
  const data = await assignObjectToTransport(client, object, opts.tr);
  return { data, human: formatAssign(data) };
}

function formatList(data: TransportListData): string {
  const rows: string[] = [];
  for (const [target, entries] of [
    ['Workbench', data.workbench],
    ['Customizing', data.customizing],
  ] as const) {
    if (entries.length === 0) continue;
    rows.push(`${target}:`);
    for (const e of entries) {
      rows.push(`  ${e.number}  ${e.status}  ${e.owner}  ${e.description}`);
    }
  }
  return rows.length > 0 ? rows.join('\n') : 'No transport requests';
}

function formatShow(data: { number: string; description: string; status: string; owner: string; objects: { name: string; type: string; status: string }[] }): string {
  const lines = [`Transport ${data.number}:`, `  description: ${data.description}`, `  status: ${data.status}`, `  owner: ${data.owner}`];
  if (data.objects.length > 0) {
    lines.push('  objects:');
    for (const o of data.objects) lines.push(`    ${o.name} (${o.type}) — ${o.status}`);
  }
  return lines.join('\n');
}

function formatResolve(data: { object: string; transports: { number: string; status: string; owner: string; text: string }[] }): string {
  if (data.transports.length === 0) return `${data.object} is not assigned to any transport request.`;
  const lines = [`${data.object} belongs to:`];
  for (const t of data.transports) lines.push(`  ${t.number}  ${t.status}  ${t.owner}  ${t.text}`);
  return lines.join('\n');
}

function formatAssign(data: { object: string; transport: string; assigned: boolean }): string {
  return data.assigned
    ? `Assigned ${data.object} to transport ${data.transport}.`
    : `${data.object} is already assigned to transport ${data.transport} (no-op).`;
}
