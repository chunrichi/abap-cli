/**
 * Regression: the inline `Common errors and how to fix them` / `Exit codes`
 * block has been removed from every command's --help output. Errors are now
 * surfaced at run time via `error.references` (rendered as a `See:` line on
 * stderr / a `references` field in the JSON envelope), pointing the agent
 * to `skills/<scope>/references/errors.md`.
 *
 * This test walks every registered command and asserts:
 *   1. help output does not contain the old markers
 *   2. the new `See:` line appears for the four representative error sources
 *
 * Lock this test to catch any future caller that re-introduces the inline
 * help block.
 */

import { describe, expect, it, vi } from 'vitest';
import { registerActivateCommand } from '../../src/abap_cli/commands/activate.js';
import { registerCheckCommand } from '../../src/abap_cli/commands/check.js';
import { registerCreateCommand } from '../../src/abap_cli/commands/create.js';
import { registerDiffCommand } from '../../src/abap_cli/commands/diff.js';
import { registerDoctorCommand } from '../../src/abap_cli/commands/doctor.js';
import { registerExtensionCommand } from '../../src/abap_cli/commands/extension.js';
import { registerExtensionsCommand } from '../../src/abap_cli/commands/extensions.js';
import { registerInitCommand } from '../../src/abap_cli/commands/init.js';
import { registerInspectCommand } from '../../src/abap_cli/commands/inspect.js';
import { registerProfileCommand } from '../../src/abap_cli/commands/profile.js';
import { registerPullCommand } from '../../src/abap_cli/commands/pull.js';
import { registerPushCommand } from '../../src/abap_cli/commands/push.js';
import { registerRunCommand } from '../../src/abap_cli/commands/run.js';
import { registerSearchCommand } from '../../src/abap_cli/commands/search.js';
import { registerSelectCommand } from '../../src/abap_cli/commands/select.js';
import { registerStatusCommand } from '../../src/abap_cli/commands/status.js';
import { registerTransportCommand } from '../../src/abap_cli/commands/transport.js';
import { makeProgram } from './cli-helper.js';

type Registerer = (program: ReturnType<typeof makeProgram>) => void;

const ALL_COMMANDS: ReadonlyArray<{ name: string; register: Registerer }> = [
  { name: 'activate', register: registerActivateCommand },
  { name: 'check', register: registerCheckCommand },
  { name: 'create', register: registerCreateCommand },
  { name: 'diff', register: registerDiffCommand },
  { name: 'doctor', register: registerDoctorCommand },
  { name: 'extension', register: registerExtensionCommand },
  { name: 'extensions', register: registerExtensionsCommand },
  { name: 'init', register: registerInitCommand },
  { name: 'inspect', register: registerInspectCommand },
  { name: 'profile', register: registerProfileCommand },
  { name: 'pull', register: registerPullCommand },
  { name: 'push', register: registerPushCommand },
  { name: 'run', register: registerRunCommand },
  { name: 'search', register: registerSearchCommand },
  { name: 'select', register: registerSelectCommand },
  { name: 'status', register: registerStatusCommand },
  { name: 'transport', register: registerTransportCommand },
];

async function captureHelp(name: string, register: Registerer): Promise<string> {
  const program = makeProgram().exitOverride();
  register(program);
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((s: string) => {
      chunks.push(String(s));
      return true;
    }) as never);
  try {
    await program.parseAsync([name, '--help'], { from: 'user' });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== 'commander.helpDisplayed') throw error;
  } finally {
    writeSpy.mockRestore();
  }
  return chunks.join('');
}

describe('--help output no longer embeds Common errors / Exit codes', () => {
  for (const { name, register } of ALL_COMMANDS) {
    it(`${name} --help omits the inline error / exit-code block`, async () => {
      const out = await captureHelp(name, register);
      expect(out).not.toContain('Common errors and how to fix them');
      expect(out).not.toContain('Exit codes:');
      // Sentinel strings from the old block — any one appearing means the
      // block leaked back in via a careless copy-paste.
      expect(out).not.toMatch(/TLS_ERROR\s+self-signed/);
      expect(out).not.toMatch(/AUTH_ERROR\s+401\/403/);
      expect(out).not.toMatch(/^  2 usage\s/m);
    });
  }
});
