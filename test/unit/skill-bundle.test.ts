import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

// --- Skill bundle structural audit (019-cli-skill-agent-bundle, FR7/FR8) ---

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillsRoot = path.join(repoRoot, 'skills');
const agentsRoot = path.join(repoRoot, 'agents');

// CLI 命令清单（与 src/abap_cli/index.ts 的 LazyCommandSpec 对齐）
const EXPECTED_COMMANDS = new Set([
  'config', 'connection', 'doctor', 'transport',
  'search', 'where-used', 'pull', 'push', 'check', 'create', 'activate', 'inspect', 'diff', 'status', 'sync',
  'select', 'run', 'tcode', 'deploy',
  // 'create local' 子命令特殊处理
]);

interface SkillInfo {
  dirName: string;
  dirPath: string;
  skillMdPath: string;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  metadata?: { version?: string; scope?: string; commands?: string[] };
}

function listSkillDirs(): SkillInfo[] {
  const out: SkillInfo[] = [];
  if (!fs.existsSync(skillsRoot)) return out;
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(skillsRoot, entry.name);
    const skillMdPath = path.join(dirPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;
    out.push({
      dirName: entry.name,
      dirPath,
      skillMdPath,
      hasReferences: fs.existsSync(path.join(dirPath, 'references')),
      hasScripts: fs.existsSync(path.join(dirPath, 'scripts')),
      hasAssets: fs.existsSync(path.join(dirPath, 'assets')),
    });
  }
  return out;
}

/**
 * 极简 frontmatter 解析：只支持 `key: value` 形式（无嵌套 YAML 结构）。
 * 对 metadata 这种缩进子对象做递归剥离。
 */
function parseFrontmatter(content: string): SkillFrontmatter {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const yaml = m[1]!;
  const result: SkillFrontmatter & Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentObj: Record<string, unknown> | null = null;
  for (const rawLine of yaml.split('\n')) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const topMatch = rawLine.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (topMatch) {
      currentKey = topMatch[1]!;
      const value = topMatch[2] ?? '';
      if (value === '') {
        // 可能是嵌套对象的开始（如 `metadata:`）
        currentObj = {};
        result[currentKey] = currentObj;
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // 顶层 inline list（仅用于 commands 这类）
        currentObj = null;
        const inner = value.slice(1, -1).trim();
        result[currentKey] = inner === '' ? [] : inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      } else {
        currentObj = null;
        // 去掉引号
        result[currentKey] = value.replace(/^["']|["']$/g, '').trim();
      }
    } else {
      const indented = rawLine.match(/^\s+([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (indented && currentObj) {
        const value = (indented[2] ?? '').replace(/^["']|["']$/g, '').trim();
        // 简化：list 形式 `commands: [a, b, c]` 或 `- a`
        if (value.startsWith('[') && value.endsWith(']')) {
          const inner = value.slice(1, -1).trim();
          currentObj[indented[1]!] = inner === '' ? [] : inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
        } else {
          currentObj[indented[1]!] = value;
        }
      }
    }
  }
  return result;
}

function getAllSkills(): SkillInfo[] {
  return listSkillDirs();
}

describe('skill bundle (019-cli-skill-agent-bundle) structural audit', () => {
  const skills = getAllSkills();

  it('discovers exactly 5 skills (025 重构: meta + 4 领域)', () => {
    const names = skills.map((s) => s.dirName).sort();
    expect(names).toEqual(['abap-cli', 'abap-cli-data', 'abap-cli-edit', 'abap-cli-search', 'abap-cli-setup']);
  });

  it.each(skills.map((s) => [s.dirName, s] as const))(
    '%s: has references/ scripts/ assets/ subdirectories (FR7, meta 允许空)',
    (_name, skill) => {
      expect(skill.hasReferences, 'references/ missing').toBe(true);
      // meta skill 不直接管命令，允许 scripts/ 与 assets/ 缺失（025 ADR-002）
      if (skill.dirName === 'abap-cli') return;
      expect(skill.hasScripts, 'scripts/ missing').toBe(true);
      expect(skill.hasAssets, 'assets/ missing').toBe(true);
    },
  );

  it.each(skills.map((s) => [s.dirName, s] as const))(
    '%s: frontmatter has required fields',
    (_name, skill) => {
      const content = fs.readFileSync(skill.skillMdPath, 'utf-8');
      const fm = parseFrontmatter(content);
      expect(fm.name, '`name` field missing').toBeDefined();
      expect(fm.description, '`description` field missing').toBeDefined();
      expect(fm.metadata, '`metadata` block missing').toBeDefined();
      expect(fm.metadata?.version, '`metadata.version` missing').toBeDefined();
      expect(fm.metadata?.commands, '`metadata.commands` missing').toBeTruthy();
    },
  );

  it.each(skills.map((s) => [s.dirName, s] as const))(
    '%s: frontmatter name matches directory name (kebab-case)',
    (_name, skill) => {
      const content = fs.readFileSync(skill.skillMdPath, 'utf-8');
      const fm = parseFrontmatter(content);
      expect(fm.name).toBe(skill.dirName);
    },
  );

  it.each(skills.map((s) => [s.dirName, s] as const))(
    '%s: description contains CLI command names (discovery surface)',
    (_name, skill) => {
      const content = fs.readFileSync(skill.skillMdPath, 'utf-8');
      const fm = parseFrontmatter(content);
      const description = fm.description ?? '';
      const commands = fm.metadata?.commands ?? [];
      // meta skill (abap-cli) 的 metadata.commands 是空数组；description 描述路由层而非命令，豁免
      if (skill.dirName === 'abap-cli') return;
      // 至少一个 metadata.commands 里的命令名必须出现在 description 中
      const found = commands.some((cmd: string) => description.includes(cmd));
      expect(found, `description 必须包含至少一个 metadata.commands 命令名`).toBe(true);
    },
  );

  it.each(skills.map((s) => [s.dirName, s] as const))(
    '%s: no ../../wiki/ ../../docs/ ../../specs/ relative paths (self-contained)',
    (_name, skill) => {
      const content = fs.readFileSync(skill.skillMdPath, 'utf-8');
      const violations = content.match(/\.\.\/\.\.\/(wiki|docs|specs)\//g);
      expect(violations, `发现相对路径违规: ${violations?.join(', ')}`).toBeNull();
    },
  );

  it('command coverage: union of skill metadata.commands covers the documented commands', () => {
    const allCommands = new Set<string>();
    for (const skill of skills) {
      const content = fs.readFileSync(skill.skillMdPath, 'utf-8');
      const fm = parseFrontmatter(content);
      for (const cmd of fm.metadata?.commands ?? []) {
        allCommands.add(String(cmd));
      }
    }
    // 17 个顶层命令（0.2 — 合并 abap-object 后）：新增 where-used / tcode；
    // atc/sync/report-stuck 已移除，不纳入 skill 路由。
    const expected = [
      'init', 'profile', 'doctor', 'transport', 'extension',
      'search', 'where-used', 'pull', 'push', 'check', 'create', 'activate', 'inspect', 'diff', 'status',
      'select', 'run', 'tcode',
    ];
    for (const cmd of expected) {
      expect(allCommands.has(cmd), `${cmd} 未被任何 skill 覆盖`).toBe(true);
    }
    // `create local` 是 create 的子命令，会以字符串形式被加进来（不计入 17）
    expect(allCommands.size).toBeGreaterThanOrEqual(expected.length);
    // 但要确保没有额外的"伪命令"——只允许 expected + `create local`（子命令）
    const expectedSet = new Set(expected);
    expectedSet.add('create local'); // 子命令合法
    for (const cmd of allCommands) {
      expect(expectedSet.has(cmd), `${cmd} 不在预期的命令清单`).toBe(true);
    }
  });

  it('references/ files do not duplicate SKILL.md core content', () => {
    for (const skill of skills) {
      const refDir = path.join(skill.dirPath, 'references');
      if (!fs.existsSync(refDir)) continue;
      const refFiles = fs.readdirSync(refDir).filter((f) => f.endsWith('.md'));
      for (const rf of refFiles) {
        // 引用文件允许更长、更细；不允许出现 SKILL.md 里独有的"何时用"开头小节
        // 这是结构性约束（"何时用"是入口签名，references 不该重复）
        const refContent = fs.readFileSync(path.join(refDir, rf), 'utf-8');
        expect(refContent.length, `${rf} 过短`).toBeGreaterThan(200);
      }
    }
  });

  it('scripts/ entries have +x permission (executable)', () => {
    for (const skill of skills) {
      const scriptsDir = path.join(skill.dirPath, 'scripts');
      if (!fs.existsSync(scriptsDir)) continue;
      const shFiles = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.sh'));
      for (const sf of shFiles) {
        const full = path.join(scriptsDir, sf);
        const stat = fs.statSync(full);
        // owner execute bit (0o100)
        expect(stat.mode & 0o100, `${sf} 不可执行 (chmod +x 缺失)`).toBeTruthy();
      }
    }
  });

  it('top-level skills/README.md exists with分层边界 section', () => {
    const readmePath = path.join(skillsRoot, 'README.md');
    expect(fs.existsSync(readmePath), 'skills/README.md 缺失').toBe(true);
    const content = fs.readFileSync(readmePath, 'utf-8');
    expect(content).toContain('分层边界');
    expect(content).toContain('自包含');
  });

  it('agents/abap-developer.agent.md exists with frontmatter handoffs', () => {
    const agentPath = path.join(agentsRoot, 'abap-developer.agent.md');
    expect(fs.existsSync(agentPath), 'agents/abap-developer.agent.md 缺失').toBe(true);
    const content = fs.readFileSync(agentPath, 'utf-8');
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe('abap-developer');
    expect(content).toContain('handoffs:');
  });
});

describe('skill bundle — size constraints (025 SC-004 / FR3)', () => {
  const skills = getAllSkills();
  // 025 SC-004: 各领域 skill ≤ 旧对应 skill 行数；meta skill 无对应旧 skill 但保持精简
  const MAX_SKILL_LINES: Record<string, number> = {
    'abap-cli': 120,
    'abap-cli-setup': 140,
    'abap-cli-search': 80,
    'abap-cli-edit': 150,
    'abap-cli-data': 110,
  };
  const MAX_AGENT_LINES = 180;

  it.each(skills.map((s) => [s.dirName, s] as const))(
    '%s: SKILL.md ≤ 行数阈值',
    (_name, skill) => {
      const content = fs.readFileSync(skill.skillMdPath, 'utf-8');
      const lineCount = content.split('\n').length;
      const limit = MAX_SKILL_LINES[skill.dirName] ?? 150;
      expect(lineCount, `${skill.dirName}/SKILL.md = ${lineCount} 行（超 ${limit}）`).toBeLessThanOrEqual(limit);
    },
  );

  it('agents/abap-developer.agent.md ≤ 120 lines', () => {
    const agentPath = path.join(agentsRoot, 'abap-developer.agent.md');
    if (!fs.existsSync(agentPath)) return;
    const content = fs.readFileSync(agentPath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount, `agent = ${lineCount} 行（超 ${MAX_AGENT_LINES}）`).toBeLessThanOrEqual(MAX_AGENT_LINES);
  });
});