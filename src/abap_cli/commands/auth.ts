import { Command } from 'commander';
import { probeSystem } from '../clients/probe.js';
import { printError, printResult, jsonFromCommand, CliError } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

interface AuthTestOptions {
  system?: string;
  verbose?: boolean;
}

/** Exit code for the worst failing layer (FR-008): TLS→4, AUTH→5, SAP→6. */
function worstExitCode(probe: { tls: { ok: boolean }; auth: { ok: boolean }; adt: { ok: boolean }; icf: { ok: boolean } }): number | undefined {
  const codes: Record<string, number> = { tls: 4, auth: 5, adt: 6, icf: 6 };
  let worst: number | undefined;
  for (const layer of ['tls', 'auth', 'adt', 'icf'] as const) {
    if (!probe[layer].ok) {
      const code = codes[layer]!;
      if (worst === undefined || code < worst) worst = code;
    }
  }
  return worst;
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command('auth')
    .description('SAP connection and authentication diagnostics')
    .addHelpText('after', commonErrorsAfter());

  auth
    .command('test')
    .description('Probe a system across tls → auth → adt → icf layers')
    .option('--system <name>', 'System profile name to probe')
    .option('--verbose', 'Include per-layer detail')
    .action(async (opts: AuthTestOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        if (!opts.system) {
          throw new CliError('USAGE', 'auth test requires --system <name>.', {
            nextSteps: ['List profiles: abap system list', 'Probe the active system: abap auth test --system <name>'],
            example: 'abap auth test --system mock',
          });
        }
        const probe = await probeSystem(opts.system);
        const exitCode = worstExitCode(probe);
        const human = [
          `System probe '${opts.system}':`,
          ...Object.entries(probe).map(([layer, r]) => {
            const status = r.ok ? 'ok' : r.skipped ? 'skipped' : 'error';
            const detail = r.error ? ` — ${r.error.message}` : '';
            return `  ${layer}: ${status}${detail}`;
          }),
        ].join('\n');
        // The four-layer payload IS the result (success envelope); a failing
        // layer drives a non-zero exit code per FR-008 (partial results, not a crash).
        printResult(json, probe, human);
        if (exitCode !== undefined) {
          // Use exitCode (not process.exit) so commander's async handling stays intact.
          process.exitCode = exitCode;
        }
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}
