import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult } from '../output/json.js';

interface TransportEntry {
  number: string;
  description: string;
  status: string;
  owner: string;
}

interface ListData {
  workbench: TransportEntry[];
  customizing: TransportEntry[];
}

export function registerTransportCommand(program: Command): void {
  const transportCmd = program
    .command('transport')
    .description('Manage SAP transport requests');

  transportCmd
    .command('list')
    .description('List transport requests for current user')
    .option('--open', 'Show only open (unreleased) transports')
    .action(async (opts, cmd) => {
      const json = jsonFrom(cmd);
      try {
        await runList(Boolean(opts.open), json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });

  transportCmd
    .command('create')
    .description('Create a new transport request')
    .argument('<description>', 'Transport description')
    .option('--package <package>', 'Target SAP package (default $TMP)')
    .action(async (description, opts, cmd) => {
      const json = jsonFrom(cmd);
      try {
        await runCreate(description, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

/** Resolve the top-level --json flag from any nested subcommand */
function jsonFrom(cmd: Command): boolean {
  let c: Command | undefined = cmd;
  while (c.parent) c = c.parent;
  return c.opts().json ?? false;
}

interface CreateOptions {
  package?: string;
}

async function runCreate(description: string, opts: CreateOptions, json: boolean): Promise<void> {
  if (!description.trim()) {
    throw new CliError('INVALID_ARGUMENT', 'Transport description must not be empty');
  }
  const devClass = (opts.package || '$TMP').trim().toUpperCase();
  // A standalone request (no object context) references a package URL as REF.
  const ref = `/sap/bc/adt/packages/${encodeURIComponent(devClass)}`;

  const client = await AdtClientWrapper.create();
  let transport: string;
  try {
    transport = await client.createTransport(ref, description.trim(), devClass);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('TRANSPORT_CREATE_FAILED', `Failed to create transport request: ${message}`);
  }

  printResult(
    json,
    { transport, description: description.trim(), package: devClass },
    `Created transport request ${transport} (${devClass})`,
  );
}

async function runList(openOnly: boolean, json: boolean): Promise<void> {
  const client = await AdtClientWrapper.create();
  const user = client.getConfig().sap.username;
  const result = await client.userTransports(user);

  const toEntries = (requests: { 'tm:number': string; 'tm:desc': string; 'tm:status': string; 'tm:owner': string }[]) =>
    requests.map((r) => ({
      number: r['tm:number'],
      description: r['tm:desc'],
      status: r['tm:status'],
      owner: r['tm:owner'],
    }));

  const collect = (targets: typeof result.workbench, open: boolean) => {
    const out: TransportEntry[] = [];
    for (const target of targets) {
      out.push(...toEntries(open ? target.modifiable : [...target.modifiable, ...target.released]));
    }
    return out;
  };

  const data: ListData = {
    workbench: collect(result.workbench, openOnly),
    customizing: collect(result.customizing, openOnly),
  };

  printResult(json, data, formatList(data));
}

function formatList(data: ListData): string {
  const rows: string[] = [];
  for (const [target, entries] of [
    ['Workbench', data.workbench],
    ['Customizing', data.customizing],
  ] as const) {
    if (entries.length === 0) continue;
    rows.push(`${target}:`);
    for (const e of entries) {
      rows.push(`  ${e.number}  ${e.status}  ${e.owner}  ${e.description}`);
    }
  }
  return rows.length > 0 ? rows.join('\n') : 'No transport requests';
}

