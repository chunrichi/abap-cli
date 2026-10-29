import { Command } from 'commander';
import { writeStuckReport } from '../core/stuck-reports.js';
import { CliError, printError, printResult, printSchema, jsonFromCommand } from '../output/json.js';

interface ReportStuckOptions {
  goal?: string;
  tried?: string;
  where?: string;
}

export function registerReportStuckCommand(program: Command): void {
  program
    .command('report-stuck')
    .description('Record a stuck-agent report locally (feedback loop)')
    .option('--goal <text>', 'What the agent was trying to do')
    .option('--tried <text>', 'What the agent already tried')
    .option('--where <cmd>', 'Which command it was stuck on')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no I/O)')
    .action(async (opts: ReportStuckOptions & { schema?: boolean }, cmd) => {
      if (opts.schema) {
        printSchema({
          schemaVersion: 1,
          command: 'report-stuck',
          description: 'Record a stuck-agent report locally (feedback loop)',
          usage: 'report-stuck --goal <text> --tried <text> --where <cmd>',
          arguments: [],
          options: [
            { name: '--goal', type: 'string', valuePlaceholder: '<text>', required: true, description: 'What the agent was trying to do' },
            { name: '--tried', type: 'string', valuePlaceholder: '<text>', required: true, description: 'What the agent already tried' },
            { name: '--where', type: 'string', valuePlaceholder: '<cmd>', required: true, description: 'Which command it was stuck on' },
            { name: '--schema', type: 'boolean', description: 'Print this command schema and exit without I/O' },
          ],
          globalOptions: ['--json', '--pretty-json'],
          examples: [
            { command: 'abap report-stuck --goal "push zcl_demo" --tried "retried 3x" --where "abap push"', description: 'Record a stuck push attempt.' },
          ],
        });
        return;
      }
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
          : `Could not record report - degraded id ${result.id} (see warning above).`;
        printResult(json, result, human);
      } catch (error: unknown) {
        await printError(json, error);
      }
    });
}
