import { Command } from 'commander';

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy bundled ICF ABAP service to SAP system')
    .option('--tr <transport>', 'Transport number')
    .option('--package <package>', 'Target SAP package', 'ZABAP_VIBE')
    .action(async (opts) => {
      try {
        // TODO: Implement deploy logic via deployer.ts
        console.log('abap deploy: not yet implemented');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
