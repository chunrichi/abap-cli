import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { inspectObject, type InspectFlags } from '../flows/inspect-ops.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

interface InspectOptions extends InspectFlags {}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect [object]')
    .description('Inspect SAP object metadata read-only (no local files required)')
    .addHelpText('after', commonErrorsAfter())
    .option('--structure', 'Include object structure elements')
    .option('--includes', 'Include class include parts')
    .option('--locks', 'Include lock / transport ownership (read-only)')
    .option('--package', 'Include the object package name')
    .option('--activation', 'Verify active vs latest source (read-only; detect stale activation)')
    .action(async (object: string | undefined, opts: InspectOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        if (!object) {
          throw new CliError('USAGE', 'inspect requires an object name.', {
            nextSteps: ['Find objects: abap search <query>'],
            example: 'abap inspect ZCL_MY_CLASS',
          });
        }
        const client = await AdtClientWrapper.create();
        const result = await inspectObject(client, object, opts);
        const human = [
          `${result.metadata.object} (${result.metadata.type})`,
          `  uri: ${result.metadata.uri}`,
          ...(result.metadata.description ? [`  description: ${result.metadata.description}`] : []),
          ...(result.metadata.packageName ? [`  package: ${result.metadata.packageName}`] : []),
          ...(result.structure ? [`  structure: ${result.structure.length} element(s)`] : []),
          ...(result.includes ? [`  includes: ${result.includes.length} part(s)`] : []),
          ...(result.locks ? [`  locks: ${result.locks.length} request(s)`] : []),
          ...(result.activation
            ? [
                `  activation: ${result.activation.ok ? 'OK (active == latest)' : 'STALE (active != latest)'}`,
                ...result.activation.parts.map((p) => `    ${p.includeType}: ${p.active ? 'active' : 'stale'} (${p.sourceUri})`),
              ]
            : []),
        ].join('\n');
        printResult(json, result, human);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}
