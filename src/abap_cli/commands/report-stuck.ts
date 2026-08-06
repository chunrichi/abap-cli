import { Command } from 'commander';
import { writeStuckReport } from '../flows/stuck-reports.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';

interface ReportStuckOptions {
  goal?: string;
  tried?: string;
  where?: string;
}

export function registerReportStuckCommand(program: Command): void {
  program
    .command('report-stuck')
    .description('Record a stuck-agent report locally (feedback loop)')
    .addHelpText('after', commonErrorsAfter())
    .option('--goal <text>', 'What the agent was trying to do')
    .option('--tried <text>', 'What the agent already tried')
    .option('--where <cmd>', 'Which command it was stuck on')
    .action(async (opts: ReportStuckOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        if (!opts.goal || !opts.tried || !opts.where) {
          throw new CliError('USAGE', 'report-stuck requires --goal, --tried and --where.', {
            nextSteps: ['Provide all three: --goal <text> --tried <text> --where <cmd>'],
            example: 'abap report-stuck --goal "push zcl_demo" --tried "retried 3x" --where "abap push"',
          });
        }
        const result = writeStuckReport({ goal: opts.goal, tried: opts.tried, where: opts.where });
        const human = result.recorded
          ? `Stuck report ${result.id} recorded.`
          : `Could not record report — degraded id ${result.id} (see warning above).`;
        printResult(json, result, human);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}
