import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { CliError, printError, printResult, jsonFromCommand } from '../output/json.js';
import { commonErrorsAfter } from '../output/help-text.js';
import { showTransport, resolveObjectTransport, assignObjectToTransport } from '../flows/transport-ops.js';

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
    .description('Manage SAP transport requests')
    .addHelpText('after', commonErrorsAfter());

  transportCmd
    .command('list')
    .description('List transport requests for current user')
    .option('--open', 'Show only open (unreleased) transports')
    .action(async (opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runList(Boolean(opts.open), json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });

  transportCmd
    .command('create')
    .description('Create a new transport request (write — requires --yes / --dry-run in non-TTY mode)')
    .argument('<description>', 'Transport description')
    .option('--package <package>', 'Target SAP package (default $TMP)')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--yes', 'Confirm the create in non-interactive mode')
    .action(async (description, opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runCreate(description, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });

  transportCmd
    .command('show <req>')
    .description('Show structured metadata for a transport request')
    .action(async (req: string, _opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const client = await AdtClientWrapper.create();
        const data = await showTransport(client, req);
        printResult(json, data, formatShow(data));
      } catch (error: unknown) {
        printError(json, error);
      }
    });

  transportCmd
    .command('resolve <object>')
    .description('Show which transport request(s) an object belongs to (read-only)')
    .action(async (object: string, _opts, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        const client = await AdtClientWrapper.create();
        const data = await resolveObjectTransport(client, object);
        printResult(json, data, formatResolve(data));
      } catch (error: unknown) {
        printError(json, error);
      }
    });

  transportCmd
    .command('assign <object>')
    .description('Attach an object to a transport request (write — requires --yes / --dry-run in non-TTY mode; no-op when already assigned)')
    .requiredOption('--tr <transport>', 'Target transport request')
    .option('--dry-run', 'Plan only — make no mutating SAP calls')
    .option('--yes', 'Confirm the assign in non-interactive mode')
    .action(async (object: string, opts: AssignOptions, cmd) => {
      const json = jsonFromCommand(cmd);
      try {
        await runAssign(object, opts, json);
      } catch (error: unknown) {
        printError(json, error);
      }
    });
}

interface CreateOptions {
  package?: string;
  dryRun?: boolean;
  yes?: boolean;
}

interface AssignOptions {
  tr: string;
  dryRun?: boolean;
  yes?: boolean;
}

async function runCreate(description: string, opts: CreateOptions, json: boolean): Promise<void> {
  if (!description.trim()) {
    throw new CliError('INVALID_ARGUMENT', 'Transport description must not be empty');
  }
  if (!opts.dryRun && !opts.yes && !process.stdin.isTTY) {
    throw new CliError('VALIDATION_ERROR', 'transport create is a write operation; confirm with --yes or pass --dry-run.', {
      nextSteps: [
        'Re-run with --yes to actually create the transport.',
        'Or pass --dry-run to preview the request without creating it.',
      ],
      example: 'abap transport create "<description>" --yes',
    });
  }
  const devClass = (opts.package || '$TMP').trim().toUpperCase();
  // A standalone request (no object context) references a package URL as REF.
  const ref = `/sap/bc/adt/packages/${encodeURIComponent(devClass)}`;

  if (opts.dryRun) {
    printResult(
      json,
      { transport: null, description: description.trim(), package: devClass, dryRun: true, ref },
      `Would create transport request in ${devClass} (dry-run)`,
    );
    return;
  }

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

async function runAssign(object: string, opts: AssignOptions, json: boolean): Promise<void> {
  if (!process.stdin.isTTY && !opts.dryRun && !opts.yes) {
    throw new CliError('VALIDATION_ERROR', 'transport assign is a write operation; confirm with --yes or pass --dry-run.', {
      nextSteps: [
        'Re-run with --yes to actually attach the object to the transport.',
        'Or pass --dry-run to preview the assign without writing.',
      ],
      example: 'abap transport assign <object> --tr <transport> --yes',
    });
  }

  if (opts.dryRun) {
    printResult(
      json,
      { object, transport: opts.tr, assigned: false, dryRun: true },
      `Would attach ${object} to transport ${opts.tr} (dry-run)`,
    );
    return;
  }

  const client = await AdtClientWrapper.create();
  const data = await assignObjectToTransport(client, object, opts.tr);
  printResult(json, data, formatAssign(data));
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

function formatShow(data: { number: string; description: string; status: string; owner: string; objects: { name: string; type: string; status: string }[] }): string {
  const lines = [`Transport ${data.number}:`, `  description: ${data.description}`, `  status: ${data.status}`, `  owner: ${data.owner}`];
  if (data.objects.length > 0) {
    lines.push('  objects:');
    for (const o of data.objects) lines.push(`    ${o.name} (${o.type}) — ${o.status}`);
  }
  return lines.join('\n');
}

function formatResolve(data: { object: string; transports: { number: string; status: string; owner: string; text: string }[] }): string {
  if (data.transports.length === 0) return `${data.object} is not assigned to any transport request.`;
  const lines = [`${data.object} belongs to:`];
  for (const t of data.transports) lines.push(`  ${t.number}  ${t.status}  ${t.owner}  ${t.text}`);
  return lines.join('\n');
}

function formatAssign(data: { object: string; transport: string; assigned: boolean }): string {
  return data.assigned
    ? `Assigned ${data.object} to transport ${data.transport}.`
    : `${data.object} is already assigned to transport ${data.transport} (no-op).`;
}

