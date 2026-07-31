import { Command } from 'commander';

export function registerTransportCommand(program: Command): void {
  const transportCmd = program
    .command('transport')
    .description('Manage SAP transport requests');

  transportCmd
    .command('list')
    .description('List transport requests for current user')
    .option('--open', 'Show only open (unreleased) transports')
    .action(async (opts) => {
      try {
        // TODO: Implement transport list via adt-client
        console.log('abap transport list: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  transportCmd
    .command('create')
    .description('Create a new transport request')
    .argument('<description>', 'Transport description')
    .action(async (description) => {
      try {
        // TODO: Implement transport creation via adt-client
        console.log('abap transport create: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
