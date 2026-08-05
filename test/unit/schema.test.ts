import { describe, expect, it, vi } from 'vitest';
import { registerSearchCommand } from '../../src/abap_cli/commands/search.js';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { makeProgram, runCommand } from './cli-helper.js';

// --schema must never touch SAP: any client call here is a test failure.
const searchObject = vi.fn(async () => {
  throw new Error('--schema must not call SAP');
});
const createObject = vi.fn(async () => {
  throw new Error('--schema must not call SAP');
});

vi.mock('../../src/abap_cli/clients/adt-client.js', () => ({
  AdtClientWrapper: {
    create: async () => ({
      searchObject,
      createObject,
      getConfig: () => ({ transport: 'TRN001' }),
    }),
  },
}));

function parseStdout(res: { stdout: string }) {
  return JSON.parse(res.stdout);
}

describe('abap search --schema (P0.1 introspection)', () => {
  it('prints the search schema as JSON without a query and without an SAP call', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', '--schema']);
    expect(res.exitCode).toBeUndefined();
    const { status, data } = parseStdout(res);
    expect(status).toBe('success');
    expect(data.command).toBe('search');
    expect(data.schemaVersion).toBe(1);
    expect(data.arguments).toEqual([{ name: 'query', required: true, description: 'Search query (supports * wildcard)' }]);
    expect(data.options.map((o: { name: string }) => o.name)).toEqual(
      expect.arrayContaining(['--type', '--limit', '--page', '--exact', '--fuzzy', '--package', '--max']),
    );
    expect(data.exclusiveGroups).toEqual([['--exact', '--fuzzy']]);
    expect(data.globalOptions).toContain('--json');
    expect(searchObject).not.toHaveBeenCalled();
  });

  it('--limit is documented as an int with the default page size', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', '--schema']);
    const { data } = parseStdout(res);
    const limit = data.options.find((o: { name: string }) => o.name === '--limit');
    expect(limit).toMatchObject({ type: 'int', default: 20 });
  });

  it('a bare search without a query still fails with USAGE (exit 2)', async () => {
    const program = makeProgram();
    registerSearchCommand(program);
    const res = await runCommand(program, ['search', '--json']);
    expect(res.exitCode).toBe(2);
    const json = JSON.parse(res.stderr);
    expect(json.status).toBe('error');
    expect(json.error.code).toBe('USAGE');
  });
});

describe('abap create --schema (P0.1 introspection)', () => {
  it('prints the general create schema when no type is given', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', '--schema']);
    expect(res.exitCode).toBeUndefined();
    const { status, data } = parseStdout(res);
    expect(status).toBe('success');
    expect(data.command).toBe('create');
    expect(data.type).toBeUndefined();
    expect(data.arguments[0].allowedValues).toEqual(['CLAS', 'INTF', 'PROG', 'FUGR']);
    expect(data.options.map((o: { name: string }) => o.name)).toEqual(
      expect.arrayContaining(['--package', '--description', '--tr', '--no-activate', '--template', '--no-pull', '--check-only', '--audit']),
    );
    expect(createObject).not.toHaveBeenCalled();
  });

  it('shows the type-specific schema with templates for CLAS', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', '--schema', 'CLAS']);
    const { data } = parseStdout(res);
    expect(data.type).toBe('CLAS');
    expect(data.supported).toBe(true);
    expect(data.templates.map((t: { name: string }) => t.name)).toEqual(['minimal', 'public-method']);
    const template = data.options.find((o: { name: string }) => o.name === '--template');
    expect(template.allowedValues).toEqual(['minimal', 'public-method']);
    expect(createObject).not.toHaveBeenCalled();
  });

  it('reports DDIC types as unsupported (DDIC_NOT_SUPPORTED)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', '--schema', 'DOMA']);
    expect(res.exitCode).toBeUndefined();
    const { data } = parseStdout(res);
    expect(data).toMatchObject({ type: 'DOMA', supported: false, reason: 'DDIC_NOT_SUPPORTED' });
  });

  it('reports unknown types as unsupported (TYPE_NOT_SUPPORTED)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', '--schema', 'FOO']);
    expect(res.exitCode).toBeUndefined();
    const { data } = parseStdout(res);
    expect(data).toMatchObject({ type: 'FOO', supported: false, reason: 'TYPE_NOT_SUPPORTED' });
  });

  it('a bare create without type/name still fails with USAGE (exit 2)', async () => {
    const program = makeProgram();
    registerCreateCommand(program);
    const res = await runCommand(program, ['create', '--json']);
    expect(res.exitCode).toBe(2);
    const json = JSON.parse(res.stderr);
    expect(json.status).toBe('error');
    expect(json.error.code).toBe('USAGE');
  });
});
