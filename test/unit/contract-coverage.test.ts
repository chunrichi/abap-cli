import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = path.join(repoRoot, 'specs/009-existing-commands-transform/contracts/cli-commands.md');
const contractPath010 = path.join(repoRoot, 'specs/010-new-cli-commands/contracts/cli-commands.md');
const commandsDir = path.join(repoRoot, 'src/abap_cli/commands');

// Flags introduced or changed by THIS feature (spec FRs / contract delta).
// `--syntax` / `--content` / `--atc` were converted into check subcommands
// (syntax/content/atc) — the subcommand names cover the contract now.
const FEATURE_FLAGS = [
  '--limit', '--page', '--exact', '--fuzzy', '--package', '--max', // search + pull batch
  '--variant', '--changed', '--strict', // check (subcommand-shared flags)
  '--remote-only', '--local-only', '--since', '--all', // status
  '--dry-run', '--diff', '--force', '--yes', // deploy
  '--template', '--no-pull', '--check-only', '--audit', // create
  '--atomic', // push
  '--file', '--with-passwords', '--overwrite', // profile export/import
];

describe('contract coverage (T035)', () => {
  it('every feature-introduced flag is documented in the delta contract', () => {
    const contract = fs.readFileSync(contractPath, 'utf-8');
    const missing = FEATURE_FLAGS.filter((f) => !contract.includes(f));
    expect(missing).toEqual([]);
  });

  it('every feature-introduced flag is registered on its command', () => {
    const allSrc = fs
      .readdirSync(commandsDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(commandsDir, f), 'utf-8'))
      .join('\n');
    const missing = FEATURE_FLAGS.filter((f) => !allSrc.includes(`'${f}`) && !allSrc.includes(`"${f}`));
    expect(missing).toEqual([]);
  });

  it('the atc redirect, transport subcommands, and profile export/import are documented', () => {
    const contract = fs.readFileSync(contractPath, 'utf-8');
    for (const token of ['COMMAND_MOVED', 'transport show', 'transport assign', 'transport resolve', 'profile export', 'profile import']) {
      expect(contract).toContain(token);
    }
  });
});

// --- 010-new-cli-commands: six new top-level commands (SC-009) ---
// 021 removed sync and report-stuck; only doctor/inspect/diff remain from 010.
const FLAGS_010 = [
  '--verbose', '--fix', '--yes', // doctor
  '--system', // doctor
  '--structure', '--includes', '--locks', '--package', // inspect
  '--all', '--remote', '--local-only', '--limit', // diff
];

describe('contract coverage 010 (T021)', () => {
  it('every 010 flag is documented in the 010 delta contract', () => {
    const contract = fs.readFileSync(contractPath010, 'utf-8');
    const missing = FLAGS_010.filter((f) => !contract.includes(f));
    expect(missing).toEqual([]);
  });

  it('every 010 flag is registered on its command', () => {
    const allSrc = fs
      .readdirSync(commandsDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(commandsDir, f), 'utf-8'))
      .join('\n');
    const missing = FLAGS_010.filter((f) => !allSrc.includes(`'${f}`) && !allSrc.includes(`"${f}`));
    expect(missing).toEqual([]);
  });

  it('all new 010 commands (still active) are registered as lazy specs in index.ts', () => {
    const index = fs.readFileSync(path.join(repoRoot, 'src/abap_cli/index.ts'), 'utf-8');
    for (const cmd of ['doctor', 'inspect', 'diff']) {
      expect(index).toContain(`name: '${cmd}'`);
      expect(index).toContain(`./commands/${cmd}.js`);
    }
  });
});

// --- 012-unify-cli-output-contract: unified output contract (SC-003) ---
const contract012Path = path.join(repoRoot, 'specs/012-unify-cli-output-contract/contracts/cli-output.md');
const CONTRACT012_TOKENS = [
  'meta', 'category', 'UNKNOWN', 'WarningCode', 'warnings', 'durationMs',
  'cli-output', 'UNLOCK_WARNING', 'NOT_IMPLEMENTED', 'PUSH_FAILED', 'COMMAND_MOVED',
  'OBJECT_EXISTS', 'FILE_EXISTS', 'schema version',
];

describe('contract coverage 012 (T018)', () => {
  it('the unified contract documents every key token', () => {
    const contract = fs.readFileSync(contract012Path, 'utf-8').toLowerCase();
    const missing = CONTRACT012_TOKENS.filter((t) => !contract.includes(t.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it('the 008 contract points to the 012 contract as superseding', () => {
    const contract008 = fs.readFileSync(path.join(repoRoot, 'specs/008-cli-foundation/contracts/cli-commands.md'), 'utf-8');
    expect(contract008).toContain('012-unify-cli-output-contract');
  });

  it('the migration section is documented in the contract and CHANGELOG', () => {
    const contract = fs.readFileSync(contract012Path, 'utf-8');
    expect(contract).toContain('迁移记录');
    expect(contract).toContain('CHANGELOG.md');
    const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [Unreleased]');
  });
});
