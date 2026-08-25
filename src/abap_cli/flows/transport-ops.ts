import type { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';
import { resolveObject, getObjectParts } from '../core/resolve.js';

export interface TransportObjectInfo {
  name: string;
  type: string;
  status: string;
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

function toObjectInfo(o: RawTransportObject): TransportObjectInfo {
  return {
    name: o['tm:name'],
    type: o['tm:type'],
    status: o['tm:obj_info'] ?? '',
  };
}

function toTaskInfo(t: RawTransportTask): TransportTaskInfo {
  return {
    number: t['tm:number'] ?? '',
    description: t['tm:desc'] ?? '',
    status: t['tm:status'] ?? '',
    owner: t['tm:owner'] ?? '',
    objects: (t.objects ?? []).map(toObjectInfo),
  };
}

/** Collect every object reference across the request and its nested tasks. */
function collectAllReferences(details: RawTransportDetails): TransportObjectInfo[] {
  const direct = (details.objects ?? []).map(toObjectInfo);
  const fromTasks = (details.tasks ?? []).flatMap((t) => (t.objects ?? []).map(toObjectInfo));
  return [...direct, ...fromTasks];
}

/** Structured metadata for `transport show <req>` (FR-015, research §8). */
export async function showTransport(client: AdtClientWrapper, number: string): Promise<TransportRequestInfo> {
  try {
    const details = (await client.transportDetails(number)) as RawTransportDetails;
    const directObjects = (details.objects ?? []).map(toObjectInfo);
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

/** Which request(s) an object currently belongs to — read-only (FR-016). */
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
 * target transport as corrNr (research §8). Already-assigned → no-op.
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
