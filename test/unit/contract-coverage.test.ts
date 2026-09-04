import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const commandsDir = path.join(repoRoot, 'src/abap_cli/commands');

// Flags introduced by spec 009 (existing-commands-transform). The list below is
// the canonical contract source; specs/009.../cli-commands.md is a human-readable
// copy and intentionally not consulted here (specs/ is gitignored per
// .github/copilot-instructions.md).
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
  it('every 009-introduced flag is registered on its command', () => {
    const allSrc = fs
      .readdirSync(commandsDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(commandsDir, f), 'utf-8'))
      .join('\n');
    const missing = FEATURE_FLAGS.filter((f) => !allSrc.includes(`'${f}`) && !allSrc.includes(`"${f}`));
    expect(missing).toEqual([]);
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
// The contract tokens (meta/category/UNKNOWN/WarningCode/...) are checked
// indirectly via the cli-output JSON schema in
// src/abap_cli/output/cli-output.schema.json (compiled and shipped); this file
// no longer reaches into specs/.

describe('contract coverage 012 (T018)', () => {
  it('CHANGELOG keeps a top-level [Unreleased] section', () => {
    const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [Unreleased]');
  });

  it('cli-output JSON schema is bundled (consumers can validate envelopes)', () => {
    const schemaPath = path.join(repoRoot, 'src/abap_cli/output/cli-output.schema.json');
    expect(fs.existsSync(schemaPath)).toBe(true);
  });
});
