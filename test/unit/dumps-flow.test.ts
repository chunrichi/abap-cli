import { describe, expect, it, vi } from 'vitest';
import type { DumpsFeed } from 'abap-adt-api';
import {
  listDumps,
  projectDumps,
  validateDumpLimit,
  validateDumpUser,
  type DumpsClient,
} from '../../src/abap_cli/flows/core/dumps.js';
import { CliError } from '../../src/abap_cli/output/json.js';

function feedWith(dumps: DumpsFeed['dumps'], updated?: Date): DumpsFeed {
  return {
    href: '/sap/bc/adt/runtime/dumps',
    title: 'Recent ABAP runtime dumps',
    updated: updated ?? new Date('2026-08-31T12:00:00.000Z'),
    dumps,
  };
}

function feedEntry(overrides: Partial<DumpsFeed['dumps'][number]>): DumpsFeed['dumps'][number] {
  return {
    id: 'DUMP-1',
    categories: [{ term: 'TIME_OUT', label: 'ABAP runtime error' }],
    links: [],
    author: 'DEVELOPER',
    text: 'Runtime error TIME_OUT in program ZCL_TEST->RUN',
    type: 'text',
    ...overrides,
  };
}

describe('dumps flow: validateDumpLimit', () => {
  it('returns 20 when limit is undefined', () => {
    expect(validateDumpLimit(undefined)).toBe(20);
  });

  it('accepts integer strings inside 1..100', () => {
    expect(validateDumpLimit('5')).toBe(5);
    expect(validateDumpLimit('1')).toBe(1);
    expect(validateDumpLimit('100')).toBe(100);
  });

  it('accepts numbers directly', () => {
    expect(validateDumpLimit(7)).toBe(7);
  });

  it('rejects 0 and negative numbers', () => {
    expect(() => validateDumpLimit('0')).toThrowError(CliError);
    expect(() => validateDumpLimit('-3')).toThrowError(CliError);
  });

  it('rejects values above 100', () => {
    expect(() => validateDumpLimit('101')).toThrowError(/integer from 1 to 100/);
  });

  it('rejects non-integers', () => {
    expect(() => validateDumpLimit('abc')).toThrowError(CliError);
    expect(() => validateDumpLimit('3.5')).toThrowError(CliError);
  });

  it('emits INVALID_ARGUMENT with example and nextSteps', () => {
    try {
      validateDumpLimit('999');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cli = error as CliError;
      expect(cli.code).toBe('INVALID_ARGUMENT');
      expect(cli.example).toContain('--limit');
      expect(cli.nextSteps?.[0]).toContain('between 1 and');
    }
  });
});

describe('dumps flow: validateDumpUser', () => {
  it('returns undefined when undefined (default = current login user)', () => {
    expect(validateDumpUser(undefined)).toBeUndefined();
  });

  it('returns empty string when explicit empty value (opt-out filter)', () => {
    expect(validateDumpUser('')).toBe('');
    expect(validateDumpUser('   ')).toBe('');
  });

  it('uppercases and trims a valid user', () => {
    expect(validateDumpUser('  developer ')).toBe('DEVELOPER');
  });

  it('accepts 12-char names with underscores', () => {
    expect(validateDumpUser('AB1_CD2_EF3')).toBe('AB1_CD2_EF3');
  });

  it('rejects names longer than 12 chars', () => {
    expect(() => validateDumpUser('A'.repeat(13))).toThrowError(CliError);
  });

  it('rejects names with forbidden characters', () => {
    expect(() => validateDumpUser('dev-user')).toThrowError(/letters, digits, or underscores/);
    expect(() => validateDumpUser('dev.user')).toThrowError(CliError);
    expect(() => validateDumpUser('dev user')).toThrowError(CliError);
  });
});

describe('dumps flow: projectDumps', () => {
  it('projects a populated feed to compact view', () => {
    const feed = feedWith([
      feedEntry({ id: 'DUMP-A', author: 'MOCKUSER' }),
      feedEntry({
        id: 'DUMP-B',
        categories: [{ term: 'CONVT_NO_NUMBER', label: 'ABAP runtime error' }],
        text: 'Cannot convert string "abc" to type I',
      }),
    ]);
    const result = projectDumps(feed);
    expect(result.total).toBe(2);
    expect(result.returned).toBe(2);
    expect(result.dumps).toHaveLength(2);
    expect(result.dumps[0]).toMatchObject({
      id: 'DUMP-A',
      runtimeError: 'TIME_OUT',
      category: 'ABAP runtime error',
      author: 'MOCKUSER',
    });
    expect(result.dumps[1].runtimeError).toBe('CONVT_NO_NUMBER');
    expect(result.updatedAt).toBe('2026-08-31T12:00:00.000Z');
  });

  it('handles empty feed', () => {
    const result = projectDumps(feedWith([]));
    expect(result.dumps).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.returned).toBe(0);
    expect(result.updatedAt).toBeDefined();
  });

  it('omits updatedAt when feed.updated is invalid', () => {
    const feed = feedWith([]);
    feed.updated = new Date('not-a-date');
    const result = projectDumps(feed);
    expect(result.updatedAt).toBeUndefined();
  });

  it('omits author and summary when blank', () => {
    const feed = feedWith([
      feedEntry({ author: '   ', text: '   ' }),
    ]);
    const result = projectDumps(feed);
    expect(result.dumps[0].author).toBeUndefined();
    expect(result.dumps[0].summary).toBeUndefined();
  });

  it('truncates summary longer than 500 characters', () => {
    const longText = 'A'.repeat(600);
    const feed = feedWith([feedEntry({ text: longText })]);
    const result = projectDumps(feed);
    expect(result.dumps[0].summary).toBeDefined();
    expect(result.dumps[0].summary!.length).toBe(500);
    expect(result.dumps[0].summary!.endsWith('...')).toBe(true);
  });

  it('collapses whitespace inside summary', () => {
    const feed = feedWith([
      feedEntry({ text: 'line1\n\n  line2\t\tline3' }),
    ]);
    const result = projectDumps(feed);
    expect(result.dumps[0].summary).toBe('line1 line2 line3');
  });

  it('falls back to first category when no ABAP runtime error category is present', () => {
    const feed = feedWith([
      feedEntry({
        categories: [{ term: 'Aborted', label: 'Terminated ABAP program' }],
      }),
    ]);
    const result = projectDumps(feed);
    expect(result.dumps[0].runtimeError).toBe('');
    expect(result.dumps[0].category).toBe('Terminated ABAP program');
  });
});

describe('dumps flow: listDumps', () => {
  it('forwards limit and user to the client and projects the feed', async () => {
    const dumpsFn = vi.fn(async (_limit?: number, _user?: string) =>
      feedWith([feedEntry({ id: 'X' })]),
    );
    const client: DumpsClient = { dumps: dumpsFn };
    const result = await listDumps(5, 'DEVELOPER', client);
    expect(dumpsFn).toHaveBeenCalledWith(5, 'DEVELOPER');
    expect(result.dumps[0].id).toBe('X');
  });

  it('passes undefined user through when none given', async () => {
    const dumpsFn = vi.fn(async () => feedWith([]));
    const client: DumpsClient = { dumps: dumpsFn };
    await listDumps(20, undefined, client);
    expect(dumpsFn).toHaveBeenCalledWith(20, undefined);
  });
});