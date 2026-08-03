import { Command } from 'commander';
import { CliError, printError, jsonFromCommand } from '../output/json.js';

export function registerAtcCommand(program: Command): void {
  program
    .command('atc')
    .description('DEPRECATED: ATC checks moved to `abap check --atc`')
    .addHelpText(
      'after',
      '\nThis command has moved. ATC checking is now available via `abap check <file> --atc --variant <variant>`.',
    )
    .allowUnknownOption()
    .action((_opts: unknown, cmd: Command) => {
      const json = jsonFromCommand(cmd);
      printError(
        json,
        new CliError('COMMAND_MOVED', 'abap atc has moved to abap check --atc', {
          nextSteps: ['ATC checks moved to: abap check --atc', 'Run: abap check <file> --atc --variant <variant>'],
          example: 'abap check src/zcl_demo.clas.abap --atc --variant Z_ATC_VAR',
        }),
      );
    });
}
