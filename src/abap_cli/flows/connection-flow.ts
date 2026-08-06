import * as fs from 'fs';
import * as path from 'path';
import { confirm, isCancel } from '@clack/prompts';
import { getSystem, listSystemNames, deleteSystem } from '../config/user-config.js';
import { getPassword, deletePassword } from '../config/secrets.js';
import { CliError, printResult } from '../output/json.js';
import { collectWarning } from '../output/meta.js';
import { probeSystem } from '../clients/probe.js';

/** Exit 130 on Ctrl+C (@clack cancel), otherwise return the value */
export function orCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('\nAborted.');
    process.exit(130);
  }
  return value as T;
}

/** List saved connection profiles. */
export function runList(jsonOutput: boolean): void {
  const names = listSystemNames();
  if (names.length === 0) {
    printResult(jsonOutput, { systems: [] }, "No connection profiles saved. Run 'abap config' to create one.");
    return;
  }
  const systems = names.map((name) => {
    const p = getSystem(name)!;
    return { name, username: p.username, url: p.url };
  });
  const human = ['Connection profiles:', ...names.map((name) => {
    const p = getSystem(name)!;
    return `  ${name} — ${p.username}@${p.url}`;
  })].join('\n');
  printResult(jsonOutput, { systems }, human);
}

export async function runShow(name: string, jsonOutput: boolean): Promise<void> {
  const profile = getSystem(name);
  if (!profile) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`);
  }
  const password = (await getPassword(name)) ? 'stored' : 'not stored';
  const detail = {
    name,
    url: profile.url,
    client: profile.client || '100',
    username: profile.username,
    language: profile.language || 'EN',
    password,
    insecure: profile.insecure ?? false,
    ca: profile.ca || '',
  };
  const human = [
    `Connection profile '${name}':`,
    `  url:      ${detail.url}`,
    `  client:   ${detail.client}`,
    `  username: ${detail.username}`,
    `  language: ${detail.language}`,
    `  password: ${detail.password}`,
    `  insecure: ${detail.insecure}`,
    `  ca:       ${detail.ca || '(none)'}`,
  ].join('\n');
  printResult(jsonOutput, { system: detail }, human);
}

/** Switch the workspace .abap.json to reference <name>, preserving other fields. */
export async function runUse(name: string, jsonOutput: boolean): Promise<void> {
  if (!getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`, {
      nextSteps: [`Run 'abap connection add ${name} --url <url> --username <user>' to create the profile first.`],
      example: `abap connection set ${name} --url <url> --username <user> --password <pass>`,
    });
  }

  const configPath = path.resolve(process.cwd(), '.abap.json');
  let workspace: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      workspace = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // ignore parse errors — a fresh object is written below
    }
  }
  workspace.system = name;
  fs.writeFileSync(configPath, JSON.stringify(workspace, null, 2) + '\n', 'utf-8');

  printResult(
    jsonOutput,
    { configPath: '.abap.json', system: name },
    `Workspace now uses connection profile '${name}'.`,
  );
}

/** Exit code for the worst failing layer (FR-008): TLS→4, AUTH→5, SAP→6. */
function worstExitCode(probe: { tls: { ok: boolean }; auth: { ok: boolean }; adt: { ok: boolean }; icf: { ok: boolean } }): number | undefined {
  const codes: Record<string, number> = { tls: 4, auth: 5, adt: 6, icf: 6 };
  let worst: number | undefined;
  for (const layer of ['tls', 'auth', 'adt', 'icf'] as const) {
    if (!probe[layer].ok) {
      const code = codes[layer]!;
      if (worst === undefined || code < worst) worst = code;
    }
  }
  return worst;
}

/** Probe a profile across tls → auth → adt → icf and report per-layer results. */
export async function runTest(name: string, jsonOutput: boolean): Promise<void> {
  const probe = await probeSystem(name);
  const human = [
    `Connection probe '${name}':`,
    ...Object.entries(probe).map(([layer, r]) => {
      const status = r.ok ? 'ok' : r.skipped ? 'skipped' : 'error';
      const detail = r.error ? ` — ${r.error.message}` : '';
      return `  ${layer}: ${status}${detail}`;
    }),
  ].join('\n');
  printResult(jsonOutput, probe, human);
  // The four-layer payload IS the result (success envelope); a failing layer
  // drives a non-zero exit code per FR-008 (partial results, not a crash).
  const exitCode = worstExitCode(probe);
  if (exitCode !== undefined) {
    process.exitCode = exitCode;
  }
}

export async function runDelete(name: string, jsonOutput: boolean): Promise<void> {
  if (!getSystem(name)) {
    throw new CliError('CONFIG_ERROR', `Connection profile '${name}' not found.`);
  }

  if (process.stdin.isTTY) {
    const ok = orCancel(await confirm({ message: `Delete connection profile '${name}'?`, initialValue: false }));
    if (!ok) {
      console.log('Aborted. Connection profile kept.');
      process.exit(0);
    }
  }

  deleteSystem(name);

  let passwordCleaned = true;
  try {
    await deletePassword(name);
  } catch {
    passwordCleaned = false;
    collectWarning(
      'KEYCHAIN_WARNING',
      `Could not remove the stored password for '${name}'. Remove it manually in your OS keychain.`,
    );
  }

  const configPath = path.resolve(process.cwd(), '.abap.json');
  let warning: string | undefined;
  if (fs.existsSync(configPath)) {
    try {
      const workspace = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (workspace.system === name) {
        warning = `workspace .abap.json references '${name}'`;
      }
    } catch {
      // ignore parse errors
    }
  }
  if (warning) {
    collectWarning('PROFILE_MISMATCH', `${warning}. Update it with 'abap config' if needed.`);
  }

  const data: Record<string, unknown> = { deleted: name, passwordCleaned };
  printResult(jsonOutput, data, `Connection profile '${name}' deleted.`);
}
