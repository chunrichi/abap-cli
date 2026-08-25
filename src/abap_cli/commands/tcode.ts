import { Command } from 'commander';
import { jsonFromCommand, printError, printResult } from '../output/json.js';
import { runTcode, type TcodeResult } from '../flows/tcode-flow.js';

const SCHEMA = {
  schemaVersion: 1,
  command: 'tcode',
  description: 'Resolve a transaction code to its configured ABAP entry program (read-only).',
  scope: 'sap',
  usage: 'abap tcode <tcode> [--json]',
  arguments: [
    {
      name: 'tcode',
      type: 'string',
      required: true,
      maxLength: 20,
      description:
        'SAP transaction code. The lookup returns its configured entry program and screen; parameter-transaction chains are reported as entry_only in this version.',
    },
  ],
  options: [
    {
      name: '--schema',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Print this schema as JSON and exit 0 without any SAP call.',
    },
  ],
  exclusiveGroups: [['--schema', '<tcode>']],
  globalOptions: ['--json'],
  examples: [
    { description: 'Show a transaction code entry program', command: 'abap tcode ZMY_TRANSACTION' },
    { description: 'Agent integration: structured result', command: 'abap tcode SE38 --json' },
  ],
  errors: [
    { code: 'TCODE_NOT_FOUND', category: 'NOT_FOUND', exitCode: 8 },
    { code: 'TCODE_NOT_AUTHORIZED', category: 'AUTH_ERROR', exitCode: 5 },
    { code: 'INVALID_ARGUMENT', category: 'USAGE', exitCode: 2 },
  ],
};

export function registerTcodeCommand(program: Command): void {
  program
    .command('tcode')
    .description('Resolve transaction code to its ABAP entry program (read-only)')
    .argument('[tcode]', 'Transaction code (e.g. SE38)')
    .option('--schema', 'Print the command parameter schema as JSON and exit 0')
    .action(async (tcode: string | undefined, _opts: unknown, cmd: Command) => {
      const mode = jsonFromCommand(cmd);

      if (cmd.optsWithGlobals().schema) {
        console.log(JSON.stringify(SCHEMA, null, mode === 'pretty-json' ? 2 : 0));
        return;
      }
      if (!tcode) {
        process.stdout.write(cmd.helpInformation());
        return;
      }

      try {
        const result = await runTcode(tcode);
        printResult(mode, result, formatHuman(result));
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}

export function formatHuman(result: TcodeResult): string {
  const entry = result.entry.program
    ? `${result.entry.program}${result.entry.screen ? ` screen ${result.entry.screen}` : ''}`
    : '(not available)';
  const target = result.target.name
    ? `${result.target.kind} ${result.target.name}${result.target.resolved ? '' : ' (unresolved)'}`
    : '(not available)';
  const lines = [
    result.description ? `${result.tcode}: ${result.description}` : result.tcode,
    `entry:      ${entry}`,
    `target:     ${target}`,
    `resolution: ${result.resolutionState}`,
  ];
  if (result.resolutionChain.length > 1) {
    lines.push('chain:');
    for (const step of result.resolutionChain) {
      lines.push(`  ${step.tcode} -> ${step.kind} ${step.name}${step.screen ? ` screen ${step.screen}` : ''}`);
    }
  }
  return lines.join('\n');
}
