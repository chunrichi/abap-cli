import { Command } from 'commander';

export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description('Download ABAP objects from SAP to local files')
    .argument('[object-name]', 'Object name to download (e.g., ZCL_MY_CLASS)')
    .option('--type <type>', 'Object type (CLAS, PROG, INTF, etc.)')
    .option('--package <package>', 'Download all objects in a package')
    .option('--dir <path>', 'Output directory', '.')
    .action(async (objectName, opts) => {
      try {
        if (!objectName && !opts.package) {
          console.error('Error: specify an object name or --package');
          process.exit(1);
        }
        // TODO: Implement pull logic via adt-client
        console.log('abap pull: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
