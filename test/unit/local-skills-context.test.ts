import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_SPECS } from '../../src/abap_cli/registry/commands.js';

/**
 * Guard for the repo-local skills under `.agents/skills/`.
 *
 * `.agents/` is gitignored (local development asset), so this file is skipped in
 * a clean clone / CI. Locally it catches the failure mode that produced the
 * stale `dist/src/abap_cli/index.js` and `test/mock-adt/` references: no other
 * checker reads `.agents/` (`check-skills-drift` only scans `skills/`).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const localSkillsRoot = path.join(repoRoot, '.agents', 'skills');
const hasLocalSkills = fs.existsSync(localSkillsRoot);

const TOP_LEVEL_COMMANDS = new Set(COMMAND_SPECS.map((spec) => spec.name));

/** Paths that must exist, e.g. `src/abap_cli/registry/commands.ts`. */
const REPO_PATH = /(?:^|[^A-Za-z0-9_./@-])((?:src|test|tests|scripts|docs|wiki|skills|agents|abap|dist)\/[A-Za-z0-9_.@/-]+)/g;

function localSkillDirs(): string[] {
  if (!hasLocalSkills) return [];
  return fs
    .readdirSync(localSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(localSkillsRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(abs));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

function frontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const body = match[1] ?? '';
  const field = (key: string): string | undefined => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(body)?.[1]?.trim();
  return { name: field('name'), description: field('description') };
}

/** Extract inline code spans and fenced blocks — prose mentions are not contracts. */
function codeSpans(text: string): string[] {
  const spans: string[] = [];
  for (const match of text.matchAll(/```[\s\S]*?```/g)) spans.push(match[0]);
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match[1]) spans.push(match[1]);
  }
  return spans;
}

/** Capture repo paths inside code spans, ignoring placeholders (`<cmd>`, globs). */
function referencedRepoPaths(text: string): string[] {
  const found: string[] = [];
  for (const span of codeSpans(text)) {
    for (const match of span.matchAll(REPO_PATH)) {
      const raw = (match[1] ?? '').replace(/[.,;:!?。，；：！？)\]"']+$/, '');
      const nextChar = span[match.index + match[0].length] ?? '';
      if (!raw || /[<>*|{}[\]]|\.\.\./.test(raw) || raw.endsWith('/') || raw.endsWith('-')) continue;
      if (nextChar === '*' || nextChar === '<') continue;
      // Placeholder filenames used in examples (e.g. test/unit/foo.test.ts).
      if (/\/(foo|bar|example|sample)\./.test(raw)) continue;
      found.push(raw);
    }
  }
  return found;
}

/** `abap <command>` code spans; only the top-level token is checked. */
function referencedCommands(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/`abap ([a-z][a-z0-9:-]*)/g)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

describe.skipIf(!hasLocalSkills)('.agents/skills context guard', () => {
  it('every local skill has a valid SKILL.md frontmatter name/description', () => {
    const dirs = localSkillDirs();
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const text = fs.readFileSync(path.join(localSkillsRoot, dir, 'SKILL.md'), 'utf-8');
      const fm = frontmatter(text);
      expect(fm.name, `${dir}/SKILL.md: frontmatter name missing`).toBe(dir);
      expect((fm.description ?? '').length, `${dir}/SKILL.md: description missing`).toBeGreaterThan(20);
    }
  });

  it('all repo paths referenced by local skills exist', () => {
    const missing: string[] = [];
    const distExists = fs.existsSync(path.join(repoRoot, 'dist'));
    for (const dir of localSkillDirs()) {
      for (const file of markdownFiles(path.join(localSkillsRoot, dir))) {
        const text = fs.readFileSync(file, 'utf-8');
        for (const rel of referencedRepoPaths(text)) {
          // Build output is only checked when a build exists (npm test may run standalone).
          if (rel.startsWith('dist/') && !distExists) continue;
          if (!fs.existsSync(path.join(repoRoot, rel))) {
            missing.push(`${path.relative(repoRoot, file)}: ${rel}`);
          }
        }
      }
    }
    expect(missing, `local skills reference nonexistent paths:\n${missing.join('\n')}`).toEqual([]);
  });

  it('all `abap <command>` examples use a registered top-level command', () => {
    const unknown: string[] = [];
    for (const dir of localSkillDirs()) {
      for (const file of markdownFiles(path.join(localSkillsRoot, dir))) {
        const text = fs.readFileSync(file, 'utf-8');
        for (const command of referencedCommands(text)) {
          if (!TOP_LEVEL_COMMANDS.has(command)) {
            unknown.push(`${path.relative(repoRoot, file)}: abap ${command}`);
          }
        }
      }
    }
    expect(unknown, `local skills mention unregistered commands:\n${unknown.join('\n')}`).toEqual([]);
  });

  it('AGENTS.md lists every local skill', () => {
    const agentsMd = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf-8');
    const missing = localSkillDirs().filter((dir) => !agentsMd.includes(`\`${dir}\``));
    expect(missing, `AGENTS.md is missing local skills: ${missing.join(', ')}`).toEqual([]);
  });
});
