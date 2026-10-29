import type { UsageReference } from 'abap-adt-api/build/api/syntax.js';
import type { AdtClientWrapper } from '../../clients/adt-client.js';
import { CliError } from '../../output/json.js';
import { resolveObject, type ResolvedObject } from '../../core/resolve.js';

export const SUPPORTED_WHERE_USED_TYPES = ['CLAS', 'INTF', 'PROG', 'FUGR', 'TABL'] as const;
export type WhereUsedType = (typeof SUPPORTED_WHERE_USED_TYPES)[number];

export const DEFAULT_WHERE_USED_LIMIT = 100;
export const MAX_WHERE_USED_LIMIT = 500;

export interface WhereUsedReference {
  name: string;
  type: string;
  uri: string;
  parentUri?: string;
  objectIdentifier?: string;
  description?: string;
  packageName?: string;
  responsible?: string;
  usageInformation?: string;
  isResult?: boolean;
  canHaveChildren?: boolean;
}

export interface WhereUsedTarget {
  name: string;
  type: string;
  uri: string;
  packageName?: string;
}

export interface WhereUsedOptions {
  type?: string;
  refType?: string;
  packageName?: string;
  limit?: number;
}

export interface WhereUsedResult {
  queryStatus: 'found' | 'empty';
  target: WhereUsedTarget;
  references: WhereUsedReference[];
  count: number;
  totalCount: number;
  limit: number;
  truncated: boolean;
  nextSteps?: string[];
}

/** ADT types look like `CLAS/OC` or `TABL/DT`; keep only the leading root. */
export function rootObjectType(type: string): string {
  return type.trim().toUpperCase().split(/[\/@]/, 1)[0] ?? '';
}

export function validateWhereUsedType(value: string | undefined, option: string): WhereUsedType | undefined {
  if (!value?.trim()) return undefined;
  const normalized = rootObjectType(value);
  if (!(SUPPORTED_WHERE_USED_TYPES as readonly string[]).includes(normalized)) {
    throw new CliError('TYPE_NOT_SUPPORTED', `${option} does not support object type ${value}`, {
      details: { option, type: value, supportedTypes: [...SUPPORTED_WHERE_USED_TYPES] },
      nextSteps: [`Use one of: ${SUPPORTED_WHERE_USED_TYPES.join(', ')}.`],
    });
  }
  return normalized as WhereUsedType;
}

export function targetFromResolvedObject(object: ResolvedObject): WhereUsedTarget {
  return {
    name: object.name,
    type: object.type,
    uri: object.objectUrl,
    ...(object.packageName ? { packageName: object.packageName } : {}),
  };
}

export function mapUsageReference(reference: UsageReference): WhereUsedReference | undefined {
  const name = reference['adtcore:name']?.trim();
  const uri = reference.uri?.trim();
  if (!name || !uri) return undefined;
  const type = reference['adtcore:type']?.trim() || rootObjectType(uri);
  return {
    name,
    type,
    uri,
    ...(reference.parentUri ? { parentUri: reference.parentUri } : {}),
    ...(reference.objectIdentifier ? { objectIdentifier: reference.objectIdentifier } : {}),
    ...(reference['adtcore:description'] ? { description: reference['adtcore:description'] } : {}),
    ...(reference.packageRef?.['adtcore:name'] ? { packageName: reference.packageRef['adtcore:name'] } : {}),
    ...(reference['adtcore:responsible'] ? { responsible: reference['adtcore:responsible'] } : {}),
    ...(reference.usageInformation ? { usageInformation: reference.usageInformation } : {}),
    ...(typeof reference.isResult === 'boolean' ? { isResult: reference.isResult } : {}),
    ...(typeof reference.canHaveChildren === 'boolean' ? { canHaveChildren: reference.canHaveChildren } : {}),
  };
}

export function referenceKey(reference: WhereUsedReference): string {
  return `${reference.uri}|${reference.usageInformation ?? ''}`.toUpperCase();
}

/** ADT repeats a reference per usage site; collapse to unique uri+context pairs. */
export function normalizeReferences(references: UsageReference[]): WhereUsedReference[] {
  const mapped = references
    .map(mapUsageReference)
    .filter((reference): reference is WhereUsedReference => Boolean(reference));
  const unique: WhereUsedReference[] = [];
  const seen = new Set<string>();
  for (const reference of mapped) {
    const key = referenceKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(reference);
  }
  return unique;
}

export async function resolveWhereUsedTarget(
  client: AdtClientWrapper,
  name: string,
  type?: string,
): Promise<WhereUsedTarget> {
  const targetType = validateWhereUsedType(type, '--type');
  const resolved = await resolveObject(client, name, targetType);
  validateWhereUsedType(rootObjectType(resolved.type), '--type');
  return targetFromResolvedObject(resolved);
}

export async function runWhereUsed(
  client: AdtClientWrapper,
  name: string,
  options: WhereUsedOptions,
): Promise<WhereUsedResult> {
  const target = await resolveWhereUsedTarget(client, name, options.type);
  const referenceType = validateWhereUsedType(options.refType, '--ref-type');
  const rawReferences = await client.usageReferences(target.uri);
  let references = normalizeReferences(rawReferences);

  if (referenceType) {
    references = references.filter((reference) => rootObjectType(reference.type) === referenceType);
  }
  if (options.packageName?.trim()) {
    const packageName = options.packageName.trim().toUpperCase();
    references = references.filter((reference) => reference.packageName?.toUpperCase() === packageName);
  }

  const limit = options.limit ?? DEFAULT_WHERE_USED_LIMIT;
  const totalCount = references.length;
  const returned = references.slice(0, limit);
  const truncated = totalCount > returned.length;
  return {
    queryStatus: totalCount === 0 ? 'empty' : 'found',
    target,
    references: returned,
    count: returned.length,
    totalCount,
    limit,
    truncated,
    ...(truncated
      ? { nextSteps: [`Increase --limit up to ${MAX_WHERE_USED_LIMIT} or narrow with --ref-type/--package.`] }
      : {}),
  };
}
