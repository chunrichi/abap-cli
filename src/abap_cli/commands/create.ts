import { Command } from 'commander';

export function registerCreateCommand(program: Command): void {
  program
    .command('create')
    .description('Create a new ABAP object')
    .argument('<type>', 'Object type (CLAS, INTF, PROG, DOMA, DTEL, TABL, STRU, TTYP)')
    .argument('<name>', 'Object name')
    .requiredOption('--package <package>', 'Target SAP package')
    .requiredOption('--description <desc>', 'Object description')
    .option('--tr <transport>', 'Transport number')
    .action(async (type, name, opts) => {
      try {
        // Source objects (CLAS, INTF, PROG) → ADT API
        // DDIC objects (DOMA, DTEL, TABL, STRU, TTYP) → ICF client
        // TODO: Implement create logic
        console.log('abap create: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
