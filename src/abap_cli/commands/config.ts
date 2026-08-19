import { Command } from 'commander';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { loadConfig, writeProjectConfig } from '../config/project-config.js';

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Show or modify the current workspace configuration (.abap.json). Does not manage profiles — use `abap profile` for that.')
    .addHelpText('after', commonErrorsAfter())
    .action((_opts, cmd) => {
      console.log(cmd.helpInformation());
    });

  config
    .command('show')
    .description('Display the current workspace configuration')
    .action(async (_opts, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        const cfg = await loadConfig();
        // Omit sensitive fields for display
        const display = {
          systemName: cfg.systemName,
          package: cfg.package,
          transport: cfg.transport,
          sap: {
            url: cfg.sap.url,
            client: cfg.sap.client,
            username: cfg.sap.username,
            language: cfg.sap.language,
            insecure: cfg.sap.insecure,
            caPath: cfg.sap.caPath,
            sourceDir: cfg.sap.sourceDir,
            // password intentionally omitted
          },
        };
        printResult(mode, display, 'Current workspace configuration');
      } catch (error: unknown) {
        printError(mode, error);
      }
    });

  config
    .command('set')
    .description('Update the current workspace configuration')
    .option('--profile <name>', 'Bind to a connection profile (created with `abap profile add`)')
    .option('--package <pkg>', 'Default SAP package for this workspace')
    .option('--tr <transport>', 'Default transport request for this workspace')
    .option('--source-dir <path>', 'Base directory for `push --all` / `check --all`')
    .action(async (opts: {
      profile?: string;
      package?: string;
      tr?: string;
      sourceDir?: string;
    }, cmd) => {
      const mode = jsonFromCommand(cmd);
      try {
        if (Object.keys(opts).length === 0) {
          printError(mode, new CliError('USAGE',
            'No options provided. Provide at least one of: --profile, --package, --tr, --source-dir',
            { nextSteps: ["Run 'abap config set --package Z_MY_PKG'."], example: 'abap config set --package Z_MY_PKG --tr DEVK900001' }));
          return;
        }
        const cfg = await loadConfig();

        if (opts.profile !== undefined) {
          cfg.systemName = opts.profile;
        }
        if (opts.package !== undefined) {
          cfg.package = opts.package;
        }
        if (opts.tr !== undefined) {
          cfg.transport = opts.tr;
        }
        if (opts.sourceDir !== undefined) {
          cfg.sap.sourceDir = opts.sourceDir;
        }

        await writeProjectConfig({
          systemName: cfg.systemName,
          package: cfg.package,
          transport: cfg.transport,
          sourceDir: cfg.sap.sourceDir,
        });
        printResult(mode, { updated: opts }, 'Workspace configuration updated');
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
