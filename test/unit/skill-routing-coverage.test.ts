import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

// --- Skill 路由覆盖测试（命令归属 / references 隔离 / agent 编排契约）---

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillsRoot = path.join(repoRoot, 'skills');
const agentsRoot = path.join(repoRoot, 'agents');

const SKILL_NAMES = [
  'abap-cli',
  'abap-cli-setup',
  'abap-cli-search',
  'abap-cli-edit',
  'abap-cli-data',
  'abap-cli-performance',
];

// 方法论 skill 不拥有命令所有权（无 metadata.commands），并用相对链接 handoff 到
// 兄弟 skill；因此不参与「领域命令唯一归属」与「SKILL.md 无兄弟引用」断言。
const METHODOLOGY_SKILLS = new Set(['abap-cli-performance']);

interface SkillFrontmatter {
  name?: string;
  description?: string;
  metadata?: { version?: string; scope?: string; commands?: string[]; skills?: string[] };
}

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
        currentObj = {};
        result[currentKey] = currentObj;
      } else if (value.startsWith('[') && value.endsWith(']')) {
        currentObj = null;
        const inner = value.slice(1, -1).trim();
        result[currentKey] = inner === '' ? [] : inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      } else {
        currentObj = null;
        result[currentKey] = value.replace(/^["']|["']$/g, '').trim();
      }
    } else {
      const indented = rawLine.match(/^\s+([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (indented && currentObj) {
        const value = (indented[2] ?? '').replace(/^["']|["']$/g, '').trim();
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

function loadAllSkills(): { name: string; fm: SkillFrontmatter }[] {
  return SKILL_NAMES.map((name) => {
    const p = path.join(skillsRoot, name, 'SKILL.md');
    const fm = parseFrontmatter(fs.readFileSync(p, 'utf-8'));
    return { name, fm };
  });
}

describe('routing coverage (metadata.commands 互不相交)', () => {
  const skills = loadAllSkills();
  const commandToSkill = new Map<string, string>();

  it('每个领域 skill 的 metadata.commands 已声明且非空', () => {
    for (const s of skills) {
      if (s.name === 'abap-cli') continue; // meta 允许空数组
      if (METHODOLOGY_SKILLS.has(s.name)) continue; // 方法论 skill 不拥有命令
      const cmds = s.fm.metadata?.commands ?? [];
      expect(Array.isArray(cmds), `${s.name}: metadata.commands 必须是数组`).toBe(true);
      expect(cmds.length, `${s.name}: metadata.commands 不能为空`).toBeGreaterThan(0);
    }
  });

  it('meta skill (abap-cli) 的 metadata.commands 仅含 agent 元命令', () => {
    const meta = skills.find((s) => s.name === 'abap-cli')!;
    const cmds = meta.fm.metadata?.commands ?? [];
    // meta skill 允许有 commands，但这些必须是 agent 元命令（feedback / report-stuck 等），
    // 不允许混入任何领域 skill 已声明的命令（互不相交）。
    // 与 0.2.6+ 对齐：feedback / report-stuck 不操作 SAP 对象，归属 meta。
    expect(cmds, 'meta skill 必须有 metadata.commands 字段').toBeDefined();
    for (const cmd of cmds) {
      expect(commandToSkill.has(cmd), `meta 命令 ${cmd} 与领域 skill 重名`).toBe(false);
    }
  });

  it('同一命令不出现于多个领域 skill 的 metadata.commands', () => {
    for (const s of skills) {
      if (s.name === 'abap-cli') continue;
      if (METHODOLOGY_SKILLS.has(s.name)) continue; // 其 commands 是触发集合，不是所有权
      for (const cmd of s.fm.metadata?.commands ?? []) {
        const prev = commandToSkill.get(String(cmd));
        expect(prev, `命令 ${cmd} 重复：${prev} 与 ${s.name}`).toBeUndefined();
        commandToSkill.set(String(cmd), s.name);
      }
    }
    // 同时核对每条命令确实只命中一个
    expect(commandToSkill.size, '至少应有 22 条领域命令（不含 create local 子命令）').toBeGreaterThanOrEqual(22);
  });

  it('4 领域 skill 的 metadata.commands 并集覆盖全部 CLI 命令', () => {
    // The four domain skills must cover every top-level command except the
    // meta-skill commands (feedback / report-stuck). Derived from the registry.
    const registrySrc = fs.readFileSync(path.join(repoRoot, 'src/abap_cli/registry/commands.ts'), 'utf8');
    const expected = [...registrySrc.matchAll(/name: '([^']+)'/g)]
      .map((match) => match[1]!)
      .filter((name) => !['feedback', 'report-stuck'].includes(name));
    for (const cmd of expected) {
      expect(commandToSkill.has(cmd), `${cmd} 未被任何领域 skill 覆盖`).toBe(true);
    }
    // create local 是 create 的子命令，可作为字符串进入 commands 列表
    const allowedExtra = new Set(['create local']);
    for (const cmd of commandToSkill.keys()) {
      expect(
        expected.includes(cmd) || allowedExtra.has(cmd),
        `命令 ${cmd} 不在路由表`,
      ).toBe(true);
    }
  });
});

describe('references 隔离（零 cross-reference 到其他 skill 的 references）', () => {
  const skills = loadAllSkills();

  it.each(skills.map((s) => s.name))(
    '%s: references/ 不引用 ../abap-cli-* 兄弟 skill',
    (name) => {
      const refDir = path.join(skillsRoot, name, 'references');
      if (!fs.existsSync(refDir)) return;
      for (const rf of fs.readdirSync(refDir).filter((f) => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(refDir, rf), 'utf-8');
        const crossRefs = content.match(/\.\.\/abap-cli-[a-z-]+\//g);
        expect(crossRefs, `${name}/references/${rf} 含 cross-reference: ${crossRefs?.join(', ')}`).toBeNull();
      }
    },
  );

  it.each(skills.map((s) => s.name))(
    '%s: SKILL.md 不引用 ../abap-cli-* 兄弟 skill（仅可引用 GitHub URL）',
    (name) => {
      // 方法论 skill 的 Handoff 规则用相对链接指向兄弟 SKILL.md（安装后同目录结构成立）
      if (METHODOLOGY_SKILLS.has(name)) return;
      const content = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf-8');
      const crossRefs = content.match(/\.\.\/abap-cli-[a-z-]+\//g);
      expect(crossRefs, `${name}/SKILL.md 含兄弟 skill 引用: ${crossRefs?.join(', ')}`).toBeNull();
    },
  );
});

describe('abap-developer.agent.md 编排契约（单一路由源，无无效 handoff）', () => {
  const agentPath = path.join(agentsRoot, 'abap-developer.agent.md');
  const readAgent = () => fs.readFileSync(agentPath, 'utf-8');

  it('metadata.skills 覆盖全部 6 个 skill', () => {
    const fm = parseFrontmatter(readAgent());
    const skills = fm.metadata?.skills ?? [];
    expect(skills.slice().sort()).toEqual(
      ['abap-cli', 'abap-cli-data', 'abap-cli-edit', 'abap-cli-performance', 'abap-cli-search', 'abap-cli-setup'].sort(),
    );
  });

  it('不再声明无效 handoffs（目标应交给 abap-cli meta 路由）', () => {
    expect(readAgent()).not.toContain('handoffs:');
  });

  it('不引用已删除的 abap-code-writing / clean-abap', () => {
    expect(readAgent()).not.toMatch(/abap-code-writing|clean-abap/);
  });

  it('version 与 package.json 一致', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as { version: string };
    const fm = parseFrontmatter(readAgent());
    expect(fm.metadata?.version).toBe(pkg.version);
  });
});
