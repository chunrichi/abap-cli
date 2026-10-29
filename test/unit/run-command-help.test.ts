import { describe, expect, it, vi } from 'vitest';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { makeProgram } from './cli-helper.js';

// US4 / FR-002 — --help lists every new option and the 015 error codes.
// Commander writes help to process.stdout.write (not console.log), so capture
// that stream too.

async function runHelp(): Promise<string> {
  const program = makeProgram().exitOverride();
  registerRunCommand(program);
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((s: string) => {
      chunks.push(String(s));
      return true;
    }) as never);
  try {
    await program.parseAsync(['run', '--help'], { from: 'user' });
  } catch (error) {
    // exitOverride() surfaces help as a CommanderError with code
    // 'commander.helpDisplayed' — expected; anything else is a real failure.
    const code = (error as { code?: string })?.code;
    if (code !== 'commander.helpDisplayed') throw error;
  } finally {
    writeSpy.mockRestore();
  }
  return chunks.join('');
}

describe('abap run --help', () => {
  it('lists --method / --args / --timeout / --dry-run and --schema', async () => {
    const out = await runHelp();
    for (const opt of ['--method', '--args', '--timeout', '--dry-run', '--schema']) {
      expect(out).toContain(opt);
    }
  });

  it('does not embed the old common-errors / exit-codes block', async () => {
    // US-recent: the inline `Common errors and how to fix them` block was
    // removed from --help; error recovery lives in skills/*/references/errors.md
    // and is surfaced at run time via `error.references` / `See:` lines.
    const out = await runHelp();
    expect(out).not.toContain('Common errors and how to fix them');
    expect(out).not.toContain('Exit codes:');
    expect(out).not.toContain('WRAPPER_NOT_DEPLOYED');
  });
});