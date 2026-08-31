/**
 * `abap dumps` flow — list recent ST22 ABAP runtime dumps via the read-only
 * ADT Atom feed `/sap/bc/adt/runtime/dumps`.
 *
 * Pure projection: this module does not run any SAP calls of its own. The
 * caller passes an `AdtClientWrapper` (or a fake with a `dumps(limit?, user?)`
 * method) so unit tests can supply canned feeds without touching the network.
 *
 * Output shape:
 *   {
      *     updatedAt?: ISO string (when feed exposes a parseable updated date),
      *     total: number of entries returned by SAP,
      *     returned: number actually projected (== total today),
      *     dumps: DumpItem[] (compact Agent-friendly view)
      *   }
 */

import type { DumpsFeed } from 'abap-adt-api';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError } from '../output/json.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SUMMARY_LENGTH = 500;

export interface DumpItem {
  id: string;
  runtimeError: string;
  category: string;
  summary?: string;
  author?: string;
}

export interface DumpsResult {
  updatedAt?: string;
  total: number;
  returned: number;
  dumps: DumpItem[];
}

/** Minimum surface the flow needs from the ADT wrapper. */
export interface DumpsClient {
  dumps(limit?: number, user?: string): Promise<DumpsFeed>;
}

export function validateDumpLimit(raw: string | number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw new CliError('INVALID_ARGUMENT', `--limit must be an integer from 1 to ${MAX_LIMIT}`, {
      example: 'abap dumps --limit 20 --json',
      nextSteps: [`Re-run with a limit between 1 and ${MAX_LIMIT}.`],
    });
  }
  return limit;
}

export function validateDumpUser(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const user = raw.trim().toUpperCase();
  if (!user) return '';
  if (!/^[A-Z0-9_]{1,12}$/.test(user)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--user must be an SAP user name of up to 12 letters, digits, or underscores',
      { example: 'abap dumps --user DEVELOPER --json' },
    );
  }
  return user;
}

/**
 * Fetch the dumps feed and project it to the compact Agent-friendly shape.
 * Pass a custom `client` for unit tests; production callers omit it and let
 * the wrapper create the ADT connection lazily.
 */
export async function listDumps(
  limit = DEFAULT_LIMIT,
  user?: string,
  client?: DumpsClient,
): Promise<DumpsResult> {
  const adt = (client ?? (await AdtClientWrapper.create())) as DumpsClient;
  const feed = await adt.dumps(limit, user);
  return projectDumps(feed);
}

/** Project a raw `DumpsFeed` into the compact Agent-friendly view. */
export function projectDumps(feed: DumpsFeed): DumpsResult {
  const dumps = feed.dumps.map((dump) => {
    const runtimeCategory = dump.categories.find(
      (category) => category.label === 'ABAP runtime error',
    );
    const primaryCategory = runtimeCategory ?? dump.categories[0];
    const summary = summarize(dump.text);

    return {
      id: dump.id,
      runtimeError: runtimeCategory?.term ?? '',
      category: primaryCategory?.label ?? '',
      ...(summary ? { summary } : {}),
      ...(dump.author?.trim() ? { author: dump.author.trim() } : {}),
    };
  });

  return {
    ...(feed.updated instanceof Date && !Number.isNaN(feed.updated.getTime())
      ? { updatedAt: feed.updated.toISOString() }
      : {}),
    total: feed.dumps.length,
    returned: dumps.length,
    dumps,
  };
}

function summarize(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_SUMMARY_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_SUMMARY_LENGTH - 3)}...`;
}