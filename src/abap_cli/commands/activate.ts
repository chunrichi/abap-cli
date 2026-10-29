import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';
import { resolveObject } from '../core/resolve.js';
import { commandSchemas } from '../flows/setup/command-schemas.js';

interface ActivateOptions {
  type?: string;
  yes?: boolean;
}

/**
 * Activate all inactive items of an object (013 dogfooding lesson: a root-URI
 * activate can report success while method/OSI items stay inactive).
 */
export function registerActivateCommand(program: Command): void {
  program
    .command('activate [object]')
    .description('Activate inactive ABAP objects')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--yes', 'Confirm in non-interactive environments')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (object: string, opts: ActivateOptions, cmd) => {
      const mode = jsonFromCommand(cmd);
      if (cmd.optsWithGlobals().schema) {
        printSchema(commandSchemas['activate']!, mode);
        return;
      }
      try {
        if (!opts.yes && !process.stdin.isTTY) {
          throw new CliError('VALIDATION_ERROR', 'abap activate modifies SAP; confirm with --yes in non-interactive mode', {
            nextSteps: ['Re-run with --yes to apply activation.', 'Or use abap inspect <object> --activation to review the state first.'],
            example: 'abap activate ZCL_MY_CLASS --yes',
          });
        }
        const client = await AdtClientWrapper.create();
        const resolved = await resolveObject(client, object, opts.type);

        // Collect all inactive items that belong to this object. Method/OSI
        // items carry a #fragment URI; match on the object part only so a
        // same-prefix name (ZCL_FOO vs ZCL_FOO_BAR) never leaks in.
        const inact = await client.inactiveObjects();
        const mine = (inact ?? []).filter((i) => {
          const uri = (i?.object?.['adtcore:uri'] ?? '') as string;
          return uri.split('#')[0] === resolved.objectUrl;
        });

        if (mine.length === 0) {
          printResult(mode,
            { object: resolved.name, activated: 0, message: 'no inactive items to activate' },
            `${resolved.name}: no inactive items to activate.`,
          );
          return;
        }

        const items = mine.map((i) => {
          const o = i.object as { 'adtcore:uri': string; 'adtcore:type': string; 'adtcore:name': string };
          return { uri: o['adtcore:uri'], type: o['adtcore:type'], name: o['adtcore:name'], parentUri: o['adtcore:uri'].split('#')[0] ?? o['adtcore:uri'] };
        });
        const res = await client.activateAll(items);
        printResult(mode,
          { object: resolved.name, activated: items.length, messages: res.messages },
          `Activated ${items.length} inactive item(s) of ${resolved.name}.`,
        );
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
