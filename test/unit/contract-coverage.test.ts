import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = path.join(repoRoot, 'specs/009-existing-commands-transform/contracts/cli-commands.md');
const commandsDir = path.join(repoRoot, 'src/abap_cli/commands');

// Flags introduced or changed by THIS feature (spec FRs / contract delta).
const FEATURE_FLAGS = [
  '--limit', '--page', '--exact', '--fuzzy', '--package', '--max', // search + pull batch
  '--syntax', '--content', '--atc', '--variant', '--changed', '--strict', // check
  '--remote-only', '--local-only', '--since', '--all', // status
  '--dry-run', '--diff', '--force', '--yes', // deploy
  '--template', '--no-pull', '--check-only', '--audit', // create
  '--atomic', // push
  '--file', '--with-passwords', '--overwrite', // system export/import
];

describe('contract coverage (T035, SC-009)', () => {
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

  it('the atc redirect, transport subcommands, and system export/import are documented', () => {
    const contract = fs.readFileSync(contractPath, 'utf-8');
    for (const token of ['COMMAND_MOVED', 'transport show', 'transport assign', 'transport resolve', 'system export', 'system import']) {
      expect(contract).toContain(token);
    }
  });
});
