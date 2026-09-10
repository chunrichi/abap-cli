import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

// --- 025 Skill 路由覆盖测试（SC-002 / SC-005 / FR-002 / FR-008 / FR-009 / FR-010）---

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillsRoot = path.join(repoRoot, 'skills');
const agentsRoot = path.join(repoRoot, 'agents');

const SKILL_NAMES = ['abap-cli', 'abap-cli-setup', 'abap-cli-search', 'abap-cli-edit', 'abap-cli-data'];

interface SkillFrontmatter {
  name?: string;
  description?: string;
  metadata?: { version?: string; scope?: string; commands?: string[] };
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

describe('025 routing coverage (SC-002: metadata.commands 互不相交)', () => {
  const skills = loadAllSkills();
  const commandToSkill = new Map<string, string>();

  it('每个领域 skill 的 metadata.commands 已声明且非空', () => {
    for (const s of skills) {
      if (s.name === 'abap-cli') continue; // meta 允许空数组
      const cmds = s.fm.metadata?.commands ?? [];
      expect(Array.isArray(cmds), `${s.name}: metadata.commands 必须是数组`).toBe(true);
      expect(cmds.length, `${s.name}: metadata.commands 不能为空`).toBeGreaterThan(0);
    }
  });

  it('meta skill (abap-cli) 的 metadata.commands 仅含 agent 元命令（FR-009）', () => {
    const meta = skills.find((s) => s.name === 'abap-cli')!;
    const cmds = meta.fm.metadata?.commands ?? [];
    // meta skill 允许有 commands，但这些必须是 agent 元命令（feedback / report-stuck 等），
    // 不允许混入任何领域 skill 已声明的命令（互不相交）。
    // 与 0.2.6+ P3.3 spec 对齐：feedback / report-stuck 不操作 SAP 对象，归属 meta。
    expect(cmds, 'meta skill 必须有 metadata.commands 字段').toBeDefined();
    for (const cmd of cmds) {
      expect(commandToSkill.has(cmd), `meta 命令 ${cmd} 与领域 skill 重名`).toBe(false);
    }
  });

  it('同一命令不出现于多个领域 skill 的 metadata.commands（SC-002 / FR-002 / FR-010）', () => {
    for (const s of skills) {
      if (s.name === 'abap-cli') continue;
      for (const cmd of s.fm.metadata?.commands ?? []) {
        const prev = commandToSkill.get(String(cmd));
        expect(prev, `命令 ${cmd} 重复：${prev} 与 ${s.name}`).toBeUndefined();
        commandToSkill.set(String(cmd), s.name);
      }
    }
    // 同时核对每条命令确实只命中一个
    expect(commandToSkill.size, '至少应有 22 条领域命令（不含 create local 子命令）').toBeGreaterThanOrEqual(22);
  });

  it('4 领域 skill 的 metadata.commands 并集覆盖全部 CLI 命令（SC-002）', () => {
    // 0.2.6 起，'extension' 改名 'deploy'（CHANGELOG 移除 breaking）；
    // 此外新增：dumps / extensions / session / mime / validate:aff
    const expected = [
      // abap-cli-setup（7）
      'init', 'profile', 'doctor', 'transport', 'deploy',
      // abap-cli-search（7）
      'search', 'where-used', 'inspect', 'diff', 'status', 'dumps',
      // abap-cli-edit（6 顶层 + mime）
      'pull', 'push', 'check', 'create', 'activate', 'mime',
      // abap-cli-data（2）
      'select', 'run',
      // 公共
      'tcode',
      // 0.2.6 接入 setup：第三方扩展 + session 探查
      'extensions',
      'session',
      // 0.2.6 接入 edit：AFF 校验
      'validate:aff',
    ];
    for (const cmd of expected) {
      expect(commandToSkill.has(cmd), `${cmd} 未被任何领域 skill 覆盖`).toBe(true);
    }
    // create local 是 create 的子命令，可作为字符串进入 commands 列表
    const allowedExtra = new Set(['create local']);
    for (const cmd of commandToSkill.keys()) {
      expect(
        expected.includes(cmd) || allowedExtra.has(cmd),
        `命令 ${cmd} 不在 025 路由表`,
      ).toBe(true);
    }
  });
});

describe('025 references 隔离（SC-005: 零 cross-reference 到其他 skill 的 references）', () => {
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
      const content = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf-8');
      const crossRefs = content.match(/\.\.\/abap-cli-[a-z-]+\//g);
      expect(crossRefs, `${name}/SKILL.md 含兄弟 skill 引用: ${crossRefs?.join(', ')}`).toBeNull();
    },
  );
});

describe('025 abap-developer.agent.md 9 步 + 5 handoffs（SC-006 / FR-014 / FR-015）', () => {
  const agentPath = path.join(agentsRoot, 'abap-developer.agent.md');

  it('含 5 个 handoff label（FR-014）', () => {
    const content = fs.readFileSync(agentPath, 'utf-8');
    const expectedLabels = [
      'Diagnose environment',
      'Query object',
      'Edit object',
      'Consume object',
      'Route',
    ];
    for (const label of expectedLabels) {
      expect(content, `缺失 handoff label: ${label}`).toContain(label);
    }
  });

  it('含 Step 0 / Step 5.5（FR-015）', () => {
    const content = fs.readFileSync(agentPath, 'utf-8');
    expect(content).toMatch(/Step\s+0/);
    expect(content).toMatch(/Step\s+5\.5/);
  });

  it('5 个 handoff 各自指向正确的 skill agent（FR-014）', () => {
    const content = fs.readFileSync(agentPath, 'utf-8');
    const expectedTargets = [
      { label: 'Diagnose environment', target: 'abap-cli-setup' },
      { label: 'Query object', target: 'abap-cli-search' },
      { label: 'Edit object', target: 'abap-cli-edit' },
      { label: 'Consume object', target: 'abap-cli-data' },
      { label: 'Route', target: 'abap-cli' },
    ];
    for (const { label, target } of expectedTargets) {
      // 每个 label 后面跟 agent: <target>
      const re = new RegExp(`label:\\s*${label}[\\s\\S]{0,200}?agent:\\s*${target.replace(/-/g, '\\-')}`);
      expect(re.test(content), `handoff ${label} 未指向 ${target}`).toBe(true);
    }
  });

  it('引用 abap-code-writing / clean-abap 为可选串联（FR-012 / FR-013 / FR-015）', () => {
    const content = fs.readFileSync(agentPath, 'utf-8');
    expect(content).toMatch(/abap-code-writing/);
    expect(content).toMatch(/clean-abap/);
    expect(content, '应说明 .github/skills 缺失时 Step 0/5.5 是 no-op').toMatch(/no-op/);
  });
});