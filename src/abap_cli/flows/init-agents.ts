import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../output/json.js';
import { toOutputPath } from '../core/path-output.js';

/** Agent targets. Each target writes into a vendor-specific sub-directory. */
export type AgentTarget = 'generic' | 'copilot' | 'claude' | 'cursor';

const AGENT_TARGETS: AgentTarget[] = ['generic', 'copilot', 'claude', 'cursor'];

/**
 * Vendor-specific destination directories (relative to workspace root).
 * - copilot → .github/    (GitHub Copilot standard)
 * - claude  → .claude/    (Claude Code standard)
 * - cursor  → .cursor/    (Cursor standard)
 * - generic → .agents/    (neutral fallback when no vendor-specific dir is known)
 *
 * Each vendor gets a `skills/` and an `agents/` sub-tree, matching how agent
 * frameworks discover skills (SKILL.md) and agents (handoffs).
 */
const VENDOR_DIR: Record<AgentTarget, string> = {
  copilot: '.github',
  claude: '.claude',
  cursor: '.cursor',
  generic: '.agents',
};

export interface ScaffoldingResult {
  written: string[];
  skipped: string[];
}

/** Path to the bundled assets directory (resolved relative to this module). */
function bundledDir(): string {
  // Resolves to the package root in BOTH layouts:
  //   dist build : <pkg-root>/dist/src/abap_cli/flows/init-agents.js  → 4 levels up
  //   src / test : <pkg-root>/src/abap_cli/flows/init-agents.ts        → 3 levels up
  // Walk up until we find a directory containing `package.json` (cheap sanity
  // check) so dev-mode invocations don't break.
  const here = path.dirname(fileURLToPath(import.meta.url));
  let candidate = path.resolve(here);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    candidate = path.dirname(candidate);
  }
  // Fallback to original 4-level-up guess for backward compat.
  return path.resolve(here, '..', '..', '..', '..');
}

/** Copy one file: <assetsRoot>/<relPath> → <destRoot>/<relPath>. Skips if dest exists and !force. */
function copyOne(
  assetsRoot: string,
  relPath: string,
  destRoot: string,
  force: boolean,
  out: ScaffoldingResult,
): void {
  const target = path.join(destRoot, relPath);
  if (fs.existsSync(target) && !force) {
    out.skipped.push(relPath);
    return;
  }
  const source = path.join(assetsRoot, relPath);
  if (!fs.existsSync(source)) {
    out.skipped.push(`${relPath} (asset missing)`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  out.written.push(relPath);
}

/**
 * Copy a directory tree recursively, but skip any entry whose name matches one
 * of `excludeNames` (matched as exact basename). Used to drop `skills/README.md`,
 * which is repository-internal metadata (describes the repo's two `skills/` sets)
 * and has no value in a user workspace.
 */
function copyTree(
  srcDir: string,
  destDir: string,
  force: boolean,
  baseRel: string,
  out: ScaffoldingResult,
  excludeNames: ReadonlySet<string>,
): void {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) continue;
    const rel = path.join(baseRel, entry.name);
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst, force, rel, out, excludeNames);
    } else if (entry.isFile()) {
      const targetExists = fs.existsSync(dst);
      if (targetExists && !force) {
        out.skipped.push(rel);
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      out.written.push(rel);
    }
  }
}

/** Rewrite every recorded path in `out` so it carries the vendor dir prefix
 * (e.g. `skills/abap-object/SKILL.md` → `.github/skills/abap-object/SKILL.md`).
 * Token-efficient: agents see the actual final location, not an ambiguous
 * repo-rooted path that would only be true for the `generic` vendor. */
function rewritePaths(out: ScaffoldingResult, vendorDir: string): void {
  out.written = out.written.map(rewriteOne(vendorDir));
  out.skipped = out.skipped.map(rewriteOne(vendorDir));
}

function rewriteOne(vendorDir: string): (p: string) => string {
  return (p: string) => {
    if (p.startsWith(`${vendorDir}/`)) return p;
    if (p.startsWith('skills/') || p.startsWith('agents/')) return `${vendorDir}/${p}`;
    // Already vendor-prefixed overlays (CLAUDE.md, .cursor/rules/abap.mdc) — leave alone.
    return p;
  };
}

/**
 * Files that must never be copied into a user workspace.
 * - `skills/README.md` is the repository's own layering doc (talks about the
 *   repo's `.github/skills/` vs top-level `skills/` split, meaningless to a user).
 */
const REPO_METADATA_FILES: ReadonlySet<string> = new Set(['README.md']);

/**
 * Scaffold the cross-vendor base: `skills/<name>/...` and `agents/abap-developer.agent.md`
 * under `<vendorDir>/`. Does NOT write `AGENTS.md` or `copilot-instructions.md`.
 */
function scaffoldGeneric(
  root: string,
  vendorDir: string,
  force: boolean,
  out: ScaffoldingResult,
): void {
  const base = path.join(process.cwd(), vendorDir);
  copyTree(
    path.join(root, 'skills'),
    path.join(base, 'skills'),
    force,
    'skills',
    out,
    REPO_METADATA_FILES,
  );
  // copyOne already prepends 'agents/' to the relative path inside destRoot,
  // so destRoot here is the vendor dir, not vendor/agents.
  copyOne(root, 'agents/abap-developer.agent.md', base, force, out);
}

/** Claude overlay: write `CLAUDE.md` at workspace root (Claude Code discovery). */
function scaffoldClaude(force: boolean, out: ScaffoldingResult): void {
  const target = path.join(process.cwd(), 'CLAUDE.md');
  if (fs.existsSync(target) && !force) {
    out.skipped.push('CLAUDE.md');
    return;
  }
  fs.writeFileSync(target, CLAUDE_MD_TEMPLATE, 'utf-8');
  out.written.push('CLAUDE.md');
}

/** Cursor overlay: write `.cursor/rules/abap.mdc` (Cursor rule format). */
function scaffoldCursor(force: boolean, out: ScaffoldingResult): void {
  const dir = path.join(process.cwd(), '.cursor', 'rules');
  const target = path.join(dir, 'abap.mdc');
  if (fs.existsSync(target) && !force) {
    out.skipped.push('.cursor/rules/abap.mdc');
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, CURSOR_MDC_TEMPLATE, 'utf-8');
  out.written.push('.cursor/rules/abap.mdc');
}

/**
 * Scaffold agent context into the workspace under vendor-specific directories.
 *
 * Path layout (after `init --agent <target>`):
 *   copilot → .github/skills/<skill>/  +  .github/agents/abap-developer.agent.md
 *   claude  → .claude/skills/<skill>/  +  .claude/agents/abap-developer.agent.md  +  CLAUDE.md
 *   cursor  → .cursor/skills/<skill>/  +  .cursor/agents/abap-developer.agent.md  +  .cursor/rules/abap.mdc
 *   generic → .agents/skills/<skill>/  +  .agents/agents/abap-developer.agent.md
 *
 * Never writes `AGENTS.md` or `copilot-instructions.md` (those are repo-level
 * files, not user-workspace context). Idempotent: re-runs are no-ops unless
 * `force=true`.
 */
export async function scaffoldAgents(target: AgentTarget, force: boolean): Promise<ScaffoldingResult> {
  if (!AGENT_TARGETS.includes(target)) {
    throw new CliError('USAGE', `Unknown agent target: ${target}. Allowed: ${AGENT_TARGETS.join(', ')}`, {
      nextSteps: ['Run `abap init --agent copilot` (or claude/cursor/generic).'],
      example: 'abap init --agent copilot',
    });
  }
  const out: ScaffoldingResult = { written: [], skipped: [] };
  const root = bundledDir();
  const vendorDir = VENDOR_DIR[target];
  scaffoldGeneric(root, vendorDir, force, out);
  if (target === 'copilot') {
    // base only; copilot discovers skills/agents directly under .github/.
  } else if (target === 'claude') {
    scaffoldClaude(force, out);
  } else if (target === 'cursor') {
    scaffoldCursor(force, out);
  }
  rewritePaths(out, vendorDir);
  // P0: normalize every emitted path to POSIX separators (Windows path contract).
  return {
    written: out.written.map(toOutputPath),
    skipped: out.skipped.map(toOutputPath),
  };
}

const CLAUDE_MD_TEMPLATE = `# abap-cli — Claude Code integration

This workspace uses abap-cli. Run \`abap --help\` to see all commands. Claude should
prefer \`abap <command> --json\` for machine-readable output.

Skills live under \`.claude/skills/\` (abap-setup, abap-object). The
abap-developer agent (\`.claude/agents/abap-developer.agent.md\`) orchestrates them.
`;

const CURSOR_MDC_TEMPLATE = `---
description: abap-cli usage in this workspace
globs:
alwaysApply: true
---

This workspace uses abap-cli. Run \`abap --help\` for the full command tree. Always prefer \`abap <command> --json\`.

Skills live under \`.cursor/skills/\` (abap-setup, abap-object).
`;