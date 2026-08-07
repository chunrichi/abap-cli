import { describe, expect, it, vi } from 'vitest';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { registerLazyCommands, type LazyCommandSpec } from '../../src/abap_cli/core/lazy.js';
import { makeProgram, runCommand } from './cli-helper.js';

// FR-014 / SC-006 — `run` follows lazy loading: module not imported until
// dispatched (or its help is requested).

describe('run command lazy load (P1.6)', () => {
  it('registers as a lazy spec with scope=sap and a load() that imports commands/run', () => {
    const spec: LazyCommandSpec = {
      name: 'run',
      scope: 'sap',
      description: 'x',
      load: async () => ({ register: registerRunCommand }),
    };
    expect(spec.name).toBe('run');
    expect(spec.scope).toBe('sap');
    expect(typeof spec.load).toBe('function');
  });

  it('stub help lists the command without dispatching (module not imported)', async () => {
    let loaded = false;
    const program = makeProgram();
    registerLazyCommands(program, [
      {
        name: 'run',
        scope: 'sap',
        description: 'Execute an ABAP class (classrun) or a static method',
        load: async () => {
          loaded = true;
          return { register: registerRunCommand };
        },
      },
    ]);
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((s: string) => {
        writes.push(String(s));
        return true;
      }) as never);
    try {
      await program.parseAsync(['--help'], { from: 'user' });
    } catch {
      /* help exit override not needed for root help */
    } finally {
      spy.mockRestore();
    }
    expect(writes.join('')).toContain('Execute an ABAP class');
    expect(loaded).toBe(false);
  });

  it('real dispatch loads the module and runs', async () => {
    let loaded = false;
    const program = makeProgram();
    registerLazyCommands(program, [
      {
        name: 'run',
        scope: 'sap',
        description: 'x',
        load: async () => {
          loaded = true;
          return { register: registerRunCommand };
        },
      },
    ]);
    const res = await runCommand(program, ['run', '--schema']);
    expect(loaded).toBe(true);
    expect(JSON.parse(res.stdout).command).toBe('run');
  });
});