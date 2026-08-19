import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import {
  registerLazyCommands,
  type LazyCommandSpec,
} from '../../src/abap_cli/core/lazy.js';
import { makeProgram, runCommand } from './cli-helper.js';

function makeLazyProgram(specs: LazyCommandSpec[]): Command {
  const program = makeProgram();
  registerLazyCommands(program, specs);
  return program;
}

// runCommand only captures console.log; commander help goes to
// process.stdout.write, so capture that channel for the help tests.
async function runHelp(program: Command, args: string[]) {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((...chunks: unknown[]) => {
      writes.push(chunks.map(String).join(''));
      return true;
    });
  const res = await runCommand(program, args);
  spy.mockRestore();
  return { ...res, stdout: res.stdout + writes.join('') };
}

function helloSpec(loads: string[]): LazyCommandSpec {
  return {
    name: 'hello',
    description: 'Say hello',
    load: async () => {
      loads.push('hello');
      return {
        register: (p: Command) =>
          p
            .command('hello <name>')
            .description('Say hello')
            .option('--loud', 'Shout it')
            .action((name: string) => {
              console.log(`HI ${name}`);
            }),
      };
    },
  };
}

describe('lazy command registration (P1.6)', () => {
  it('root help lists commands without importing their modules', async () => {
    const loads: string[] = [];
    const program = makeLazyProgram([helloSpec(loads)]);
    const res = await runHelp(program, ['--help']);
    expect(res.stdout).toContain('Say hello');
    expect(loads).toEqual([]);
  });

  it('imports a module exactly once across repeated dispatches', async () => {
    const loads: string[] = [];
    const program = makeLazyProgram([helloSpec(loads)]);
    const first = await runCommand(program, ['hello', 'world']);
    expect(first.stdout).toContain('HI world');
    // Stub was swapped for the real command, so the second run dispatches
    // straight to the already-registered command without another import.
    const second = await runCommand(program, ['hello', 'again']);
    expect(second.stdout).toContain('HI again');
    expect(loads).toEqual(['hello']);
  });

  it('lazy-loads a command that only has subcommands', async () => {
    const loads: string[] = [];
    const spec: LazyCommandSpec = {
      name: 'team',
      description: 'Team commands',
      load: async () => {
        loads.push('team');
        return {
          register: (p: Command) => {
            p.command('team')
              .description('Team commands')
              .command('list')
              .description('List team members')
              .action(() => {
                console.log('TEAMS');
              });
          },
        };
      },
    };
    const program = makeLazyProgram([spec]);
    const res = await runCommand(program, ['team', 'list']);
    expect(res.stdout).toContain('TEAMS');
    expect(loads).toEqual(['team']);
  });

  it('loads the module to render `--help` for a lazy command', async () => {
    const loads: string[] = [];
    const program = makeLazyProgram([helloSpec(loads)]);
    const res = await runHelp(program, ['hello', '--help']);
    expect(res.stdout).toContain('--loud');
    expect(res.exitCode).toBe(0);
    expect(loads).toEqual(['hello']);
  });

  it('loads the module for `help <command>`', async () => {
    const loads: string[] = [];
    const program = makeLazyProgram([helloSpec(loads)]);
    const res = await runHelp(program, ['help', 'hello']);
    expect(res.stdout).toContain('--loud');
    expect(loads).toEqual(['hello']);
  });

  it('renders subcommand `--help` after loading its parent', async () => {
    const loads: string[] = [];
    const spec: LazyCommandSpec = {
      name: 'team',
      description: 'Team commands',
      load: async () => {
        loads.push('team');
        return {
          register: (p: Command) => {
            p.command('team')
              .description('Team commands')
              .command('list')
              .description('List team members')
              .option('--all', 'List all')
              .action(() => {});
          },
        };
      },
    };
    const program = makeLazyProgram([spec]);
    const res = await runHelp(program, ['team', 'list', '--help']);
    expect(res.stdout).toContain('--all');
    expect(res.exitCode).toBe(0);
    expect(loads).toEqual(['team']);
  });
});

// --- Static consistency: stub descriptions must match the command modules ---
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMMAND_NAMES = [
  'init', 'pull', 'push', 'check', 'search', 'create', 'status',
  'transport', 'extension', 'profile', 'doctor', 'inspect', 'diff',
];

describe('lazy spec descriptions (P1.6)', () => {
  it('every COMMAND_NAMES entry is registered as a lazy spec in index.ts', () => {
    const index = fs.readFileSync(path.join(repoRoot, 'src/abap_cli/index.ts'), 'utf-8');
    for (const name of COMMAND_NAMES) {
      expect(index).toContain(`name: '${name}'`);
      expect(index).toContain(`./commands/${name}.js`);
    }
  });

  it('spec descriptions match the description each module registers', () => {
    const index = fs.readFileSync(path.join(repoRoot, 'src/abap_cli/index.ts'), 'utf-8');
    for (const name of COMMAND_NAMES) {
      const specDesc = index.match(
        new RegExp(`name: '${name}',[\\s\\S]*?description: '([^']*)'`),
      )?.[1];
      expect(specDesc, `index.ts has a description for '${name}'`).toBeDefined();
      const moduleSrc = fs.readFileSync(
        path.join(repoRoot, `src/abap_cli/commands/${name}.ts`),
        'utf-8',
      );
      const moduleDesc = moduleSrc.match(/\.description\('([^']*)'\)/)?.[1];
      expect(moduleDesc, `commands/${name}.ts has a description`).toBeDefined();
      expect(specDesc, `'${name}' root help description matches its module`).toBe(moduleDesc);
    }
  });
});

// --- Process-level end-to-end: the built CLI lazy-loads and still works ---
const cliEntry = path.join(repoRoot, 'dist/src/abap_cli/index.js');
const run = promisify(execFile);
const hasBuiltCli = fs.existsSync(cliEntry);

describe('lazy loading at the process level (P1.6)', () => {
  it.skipIf(!hasBuiltCli)('--help lists commands without any SAP call', async () => {
    const { stdout } = await run(process.execPath, [cliEntry, '--help']);
    for (const name of ['init', 'pull', 'transport', 'profile']) {
      expect(stdout).toContain(name);
    }
  });

  it.skipIf(!hasBuiltCli)('a subcommand --help lazy-loads its module (exit 0)', async () => {
    const { stdout } = await run(process.execPath, [cliEntry, 'transport', 'list', '--help']);
    expect(stdout).toContain('List transport requests for current user');
  });

  it.skipIf(!hasBuiltCli)('search --schema runs without loading SAP clients', async () => {
    const { stdout } = await run(process.execPath, [cliEntry, 'search', '--schema']);
    expect(stdout).toContain('"status":"success"');
    expect(stdout).toContain('"schemaVersion"');
  });
});

// --- root --help groups local commands under a dedicated section (P2.9) ---
const LOCAL_NAMES = ['init', 'profile', 'doctor'];
const SAP_NAMES = ['pull', 'push', 'check', 'search', 'create', 'status', 'transport', 'extension', 'inspect', 'diff'];

describe('lazy command scope grouping (P2.9)', () => {
  it('every lazy spec is annotated as either local or sap (defaults to sap)', () => {
    const index = fs.readFileSync(path.join(repoRoot, 'src/abap_cli/index.ts'), 'utf-8');
    // Each spec is a `{\n  name: 'X', ...\n},` block. Anchor on the `name:`
    // line so the match doesn't start at the first `{` in the file (which is
    // an import block).
    const blockFor = (name: string): string | null => {
      const re = new RegExp(
        `name:\\s*'${name}',[\\s\\S]*?\\},`,
      );
      return index.match(re)?.[0] ?? null;
    };
    for (const name of LOCAL_NAMES) {
      const block = blockFor(name);
      expect(block, `${name} spec block exists`).toBeTruthy();
      expect(block, `${name} declares scope: 'local'`).toMatch(/scope:\s*'local'/);
    }
    for (const name of SAP_NAMES) {
      const block = blockFor(name);
      expect(block, `${name} spec block exists`).toBeTruthy();
      // If scope is set, it must be 'sap'; absence is fine (default).
      const scope = block!.match(/scope:\s*'(local|sap)'/)?.[1];
      if (scope) {
        expect(scope, `${name} declared scope is SAP`).toBe('sap');
      }
    }
  });

  it('root help lists only local commands under the "Local commands" section', async () => {
    const program = makeLazyProgram([
      { name: 'config', scope: 'local', description: 'Config', load: helloSpec([]).load },
      { name: 'pull', description: 'Pull', load: helloSpec([]).load },
      { name: 'doctor', scope: 'local', description: 'Doctor', load: helloSpec([]).load },
    ]);
    const res = await runHelp(program, ['--help']);
    expect(res.stdout).toContain('Local commands (no SAP connection required):');
    // The local section lists only the local commands.
    const localSection = res.stdout.split('Local commands (no SAP connection required):')[1] ?? '';
    expect(localSection).toContain('config');
    expect(localSection).toContain('doctor');
    expect(localSection).not.toContain('pull');
  });

  it('root help omits the "Local commands" section when no local specs exist', async () => {
    const program = makeLazyProgram([
      { name: 'pull', description: 'Pull', load: helloSpec([]).load },
    ]);
    const res = await runHelp(program, ['--help']);
    expect(res.stdout).not.toContain('Local commands (no SAP connection required):');
  });

  it.skipIf(!hasBuiltCli)('built CLI root --help groups init/profile/doctor as local', async () => {
    const { stdout } = await run(process.execPath, [cliEntry, '--help']);
    expect(stdout).toContain('Local commands (no SAP connection required):');
    // The Local section is the block between the heading and the next
    // blank line that follows the closing "These commands do not call SAP."
    // hint. Scope to that block so the unrelated Commands: list (and its
    // own duplicates) don't bleed into the assertion.
    const localSection = stdout
      .split('Local commands (no SAP connection required):')[1]
      ?.split('These commands do not call SAP.')[0] ?? '';
    for (const name of LOCAL_NAMES) {
      expect(localSection, `'${name}' is listed under the Local section`).toContain(name);
    }
    // SAP commands must not appear in the local section.
    // Use word-boundary regex (\b) so 'extension' doesn't false-match 'extensions'.
    for (const name of SAP_NAMES) {
      const re = new RegExp(`\\b${name}\\b`);
      expect(localSection, `'${name}' must NOT be in the local section`).not.toMatch(re);
    }
  });
});
