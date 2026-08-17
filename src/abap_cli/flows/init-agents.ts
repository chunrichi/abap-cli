import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../output/json.js';

/** Agent targets and their file mappings. `generic` is the base; vendor values stack on top. */
export type AgentTarget = 'generic' | 'copilot' | 'claude' | 'cursor';

const AGENT_TARGETS: AgentTarget[] = ['generic', 'copilot', 'claude', 'cursor'];

export interface ScaffoldingResult {
  written: string[];
  skipped: string[];
}

/** Path to the bundled assets directory (resolved relative to this module). */
function bundledDir(): string {
  // Layout: <pkg-root>/dist/src/abap_cli/flows/init-agents.js
  // Assets live at <pkg-root>/skills and <pkg-root>/agents.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..');
}

/** Copy a single file from <assetsRoot>/<relPath> to <dest>/<relPath>. Skips if dest exists and !force. */
function copyOne(assetsRoot: string, relPath: string, dest: string, force: boolean, out: ScaffoldingResult): void {
  const target = path.join(dest, relPath);
  if (fs.existsSync(target) && !force) {
    out.skipped.push(relPath);
    return;
  }
  const source = path.join(assetsRoot, relPath);
  if (!fs.existsSync(source)) {
    // Asset missing in package — count as skipped with a clear path.
    out.skipped.push(`${relPath} (asset missing)`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  out.written.push(relPath);
}

/** Copy a directory tree recursively. */
function copyTree(srcDir: string, destDir: string, force: boolean, baseRel: string, out: ScaffoldingResult): void {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = path.join(baseRel, entry.name);
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst, force, rel, out);
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

/** Copy AGENTS.md from the package root to the workspace. */
function scaffoldGeneric(root: string, force: boolean, out: ScaffoldingResult): void {
  // skills/ tree + agents/abap-developer.md + AGENTS.md (cross-vendor standard).
  copyTree(path.join(root, 'skills'), path.join(process.cwd(), 'skills'), force, 'skills', out);
  copyOne(root, 'agents/abap-developer.md', process.cwd(), force, out);
  copyOne(root, 'AGENTS.md', process.cwd(), force, out);
}

/** Vendor-specific overlays. All build on top of `generic`. */
function scaffoldCopilot(force: boolean, out: ScaffoldingResult): void {
  copyOne(path.join(bundledDir(), '.github'), 'copilot-instructions.md', path.join(process.cwd(), '.github'), force, out);
}
function scaffoldClaude(force: boolean, out: ScaffoldingResult): void {
  const target = path.join(process.cwd(), 'CLAUDE.md');
  if (fs.existsSync(target) && !force) {
    out.skipped.push('CLAUDE.md');
    return;
  }
  fs.writeFileSync(target, CLAUDE_MD_TEMPLATE, 'utf-8');
  out.written.push('CLAUDE.md');
}
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

/** Scaffold the requested agent(s). Idempotent: re-runs are no-ops unless force=true. */
export async function scaffoldAgents(target: AgentTarget, force: boolean): Promise<ScaffoldingResult> {
  if (!AGENT_TARGETS.includes(target)) {
    throw new CliError('USAGE', `Unknown agent target: ${target}. Allowed: ${AGENT_TARGETS.join(', ')}`, {
      nextSteps: ['Run `abap init --agent copilot` (or claude/cursor/generic).'],
      example: 'abap init --agent copilot',
    });
  }
  const out: ScaffoldingResult = { written: [], skipped: [] };
  const root = bundledDir();
  // All targets include the generic base.
  scaffoldGeneric(root, force, out);
  if (target === 'copilot') scaffoldCopilot(force, out);
  if (target === 'claude') scaffoldClaude(force, out);
  if (target === 'cursor') scaffoldCursor(force, out);
  return out;
}

const CLAUDE_MD_TEMPLATE = `# abap-cli — Claude Code integration

This workspace uses abap-cli. Run \`abap --help\` to see all commands. Claude should
prefer \`abap <command> --json\` for machine-readable output.

See \`AGENTS.md\` in this workspace for full project conventions.
`;

const CURSOR_MDC_TEMPLATE = `---
description: abap-cli usage in this workspace
globs:
alwaysApply: true
---

This workspace uses abap-cli. Run \`abap --help\` for the full command tree. Always prefer \`abap <command> --json\`.

See \`AGENTS.md\` in this workspace for project conventions.
`;