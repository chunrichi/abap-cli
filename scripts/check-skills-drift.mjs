#!/usr/bin/env node
/**
 * `scripts/check-skills-drift.mjs` — 检测 skills/ 与实际 CLI 实现之间的漂移。
 *
 * 检查项：
 *  1. 命令覆盖核对：每个 SKILL.md 的 `metadata.commands` 是否完整覆盖 src/abap_cli/index.ts
 *     的 COMMAND_SPECS（25 顶层命令）。
 *  2. SKILL.md 版本号：必须 == package.json 的 version（防 0.2.6 vs 0.4.0 漂移）。
 *  3. 已退役命令：grep `extension deploy`、`extension status`、已被 0.2.6 删除。
 *  4. 路由表 vs 实际 commands：skills/README.md 与 skills/abap-cli/SKILL.md 的路由表
 *     覆盖数 == 25。
 *  5. 脚本调用：scripts/*.mjs 中 spawn('abap', [...]) 的第一参数必须在 COMMAND_SPECS
 *     中（防 deploy-if-outdated.mjs:41 那种 `extension deploy` typo）。
 *  6. ICF 服务版本：skills 中提及的 ICF_SERVICE_VERSION 必须 == src/ 中的实际常量。
 *
 * Exit codes：
 *   0 — 无漂移
 *   1 — 有漂移（打印详情）
 *
 * 用法：
 *   node scripts/check-skills-drift.mjs           # 报告模式（人类可读）
 *   node scripts/check-skills-drift.mjs --json    # JSON 输出（CI 友好）
 *   node scripts/check-skills-drift.mjs --fix     # 自动修复可修复项（如 version）
 *
 * 不进网络；纯本地静态分析。
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ─── helpers ──────────────────────────────────────────────────────────────
function readJson(p) {
    return JSON.parse(readFileSync(p, 'utf8'));
}

function readText(p) {
    return readFileSync(p, 'utf8');
}

function listFiles(dir, ext) {
    const { readdirSync, statSync } = require('node:fs');
    const out = [];
    function walk(d) {
        for (const e of readdirSync(d)) {
            const full = path.join(d, e);
            const st = statSync(full);
            if (st.isDirectory()) walk(full);
            else if (!ext || full.endsWith(ext)) out.push(full);
        }
    }
    walk(dir);
    return out;
}

// lazy require (ESM doesn't have require)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ─── 1. 加载实际命令清单（from src/abap_cli/index.ts 的 COMMAND_SPECS）───────
function extractTopLevelCommands() {
    const ts = readText(path.join(repoRoot, 'src/abap_cli/index.ts'));
    const nameRe = /^\s*name:\s*['"]([^'"]+)['"]/gm;
    const out = [];
    let m;
    while ((m = nameRe.exec(ts))) out.push(m[1]);
    return out;
}

// ─── 2. 加载每个 SKILL.md 的 metadata.commands ────────────────────────────────
function parseSkillFrontmatter(text) {
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return null;
    const block = fm[1];
    const name = block.match(/^name:\s*['"]?([^'"\n]+)['"]?/m)?.[1];
    const version = block.match(/^  version:\s*['"]([^'"]+)['"]/m)?.[1];
    const commandsMatch = block.match(/^  commands:\s*\[(.*?)\]/m);
    const commands = commandsMatch
        ? commandsMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        : [];
    return { name, version, commands };
}

function loadAllSkills() {
    const skillsRoot = path.join(repoRoot, 'skills');
    const out = [];
    for (const e of require('node:fs').readdirSync(skillsRoot)) {
        const full = path.join(skillsRoot, e);
        if (!require('node:fs').statSync(full).isDirectory()) continue;
        const skillMd = path.join(full, 'SKILL.md');
        if (!existsSync(skillMd)) continue;
        const fm = parseSkillFrontmatter(readText(skillMd));
        if (fm) out.push({ path: skillMd, ...fm });
    }
    return out;
}

// ─── 3. 加载 package.json 的版本号 ───────────────────────────────────────────
const pkg = readJson(path.join(repoRoot, 'package.json'));
const pkgVersion = pkg.version;

// ─── 4. 加载 src 中 ICF_SERVICE_VERSION 常量 ────────────────────────────────
function extractIcfVersion() {
    const ts = readText(path.join(repoRoot, 'src/abap_cli/clients/icf-version.ts'));
    const m = ts.match(/ICF_SERVICE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m?.[1];
}

// ─── 5. 加载 scripts/*.mjs 中 spawn('abap', [...]) 的第一参数 ─────────────────
function extractScriptSpawns() {
    const scriptsDir = path.join(repoRoot, 'skills');
    const out = [];
    for (const e of require('node:fs').readdirSync(scriptsDir)) {
        const dir = path.join(scriptsDir, e);
        if (!require('node:fs').statSync(dir).isDirectory()) continue;
        const scriptsSub = path.join(dir, 'scripts');
        if (!existsSync(scriptsSub)) continue;
        for (const f of require('node:fs').readdirSync(scriptsSub)) {
            if (!f.endsWith('.mjs')) continue;
            const content = readText(path.join(scriptsSub, f));
            // 找 run(['xx', ...]) 形式
            const re = /run\(\s*\[\s*['"]([^'"]+)['"]/g;
            let m;
            while ((m = re.exec(content))) {
                out.push({ file: path.join(scriptsSub, f), firstArg: m[1] });
            }
        }
    }
    return out;
}

// ─── drift checks ─────────────────────────────────────────────────────────
const issues = [];

function check(label, ok, detail) {
    issues.push({ label, ok, detail });
}

const topCmds = extractTopLevelCommands();
const skills = loadAllSkills();
const icfVersion = extractIcfVersion();
const scriptSpawns = extractScriptSpawns();

// 1. 命令覆盖：4 领域 + meta 的 commands 并集 == topCmds
const covered = new Set();
for (const s of skills) {
    for (const c of s.commands) covered.add(c);
}
// performance 也算但其 commands 是触发的其他命令的子集，跳过
const missingFromSkills = topCmds.filter((c) => !covered.has(c));
check(
    'command-coverage',
    missingFromSkills.length === 0,
    missingFromSkills.length === 0
        ? `全部 ${topCmds.length} 个顶层命令被 6 个 skill 覆盖`
        : `以下命令未被任何 SKILL.md 的 metadata.commands 收录：${missingFromSkills.join(', ')}`,
);

// 2. SKILL.md version == package.json version
for (const s of skills) {
    check(
        `version:${s.name}`,
        s.version === pkgVersion,
        `${path.relative(repoRoot, s.path)}: version ${s.version} ${s.version === pkgVersion ? '✓' : `≠ package.json ${pkgVersion}`}`,
    );
}

// 3. 已退役命令（extension deploy / extension status）
const retiredPatterns = [
    { re: /\babap extension deploy\b/g, label: 'extension deploy (0.2.6 renamed to deploy)' },
    { re: /\babap extension status\b/g, label: 'extension status (0.2.6 renamed to deploy status)' },
    { re: /\bextension deploy\b(?! \.mjs)/g, label: 'extension deploy reference' },
    { re: /\bextension status\b(?! \.mjs)/g, label: 'extension status reference' },
];
for (const s of skills) {
    const allFiles = listFiles(path.dirname(s.path), '.md');
    for (const f of allFiles) {
        const text = readText(f);
        for (const { re, label } of retiredPatterns) {
            re.lastIndex = 0;
            const hits = [...text.matchAll(re)];
            if (hits.length > 0) {
                check(
                    `retired:${label}`,
                    false,
                    `${path.relative(repoRoot, f)}: ${hits.length} 处「${label}」`,
                );
            }
        }
    }
}

// 4. scripts/*.mjs 中 spawn 的第一参数
for (const { file, firstArg } of scriptSpawns) {
    // 第一参数：'deploy' / 'doctor' / 'profile' / 'transport' / 'select' / 'extension'(deprecated) 等
    // 顶级命令应是 topCmds 之一，或者是 'extension'（历史遗留）但脚本里已替换
    const ok = topCmds.includes(firstArg) || firstArg === 'extension';
    check(
        `script-spawn:${file}:${firstArg}`,
        ok,
        `${path.relative(repoRoot, file)}: spawn('abap', ['${firstArg}', ...]) ${ok ? '✓' : '✗ first arg 不在 COMMAND_SPECS'}`,
    );
}

// 5. ICF_SERVICE_VERSION 一致性
const skillTexts = [
    readText(path.join(repoRoot, 'skills/abap-cli-data/references/commands-quick.md')),
    readText(path.join(repoRoot, 'skills/abap-cli-setup/SKILL.md')),
    readText(path.join(repoRoot, 'skills/abap-cli-setup/references/commands-quick.md')),
];
const verRefs = [];
for (const [i, text] of skillTexts.entries()) {
    const re = /service 0\.\d+\.\d+/g;
    let m;
    while ((m = re.exec(text))) verRefs.push({ idx: i, ref: m[0] });
}
const wrongVer = verRefs.filter((v) => v.ref !== `service ${icfVersion}`);
check(
    'icf-version',
    wrongVer.length === 0,
    wrongVer.length === 0
        ? `全部引用都是 service ${icfVersion}`
        : `ICF_SERVICE_VERSION 引用不一致：${wrongVer.map((v) => v.ref).join(', ')}（应为 ${icfVersion}）`,
);

// ─── auto-fix（保守） ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isFix = args.includes('--fix');

if (isFix) {
    let fixed = 0;
    // 修 SKILL.md version
    for (const s of skills) {
        if (s.version !== pkgVersion) {
            const text = readText(s.path);
            const newText = text.replace(
                /^(  version:\s*['"])([^'"]+)(['"])/m,
                `$1${pkgVersion}$3`,
            );
            if (newText !== text) {
                writeFileSync(s.path, newText, 'utf8');
                fixed++;
            }
        }
    }
    if (fixed > 0) {
        console.error(`--fix: 已更新 ${fixed} 个 SKILL.md 的 version → ${pkgVersion}`);
    }
}

// ─── output ───────────────────────────────────────────────────────────────
const isJson = args.includes('--json');
const failed = issues.filter((i) => !i.ok);

if (isJson) {
    process.stdout.write(
        JSON.stringify(
            {
                checkedAt: new Date().toISOString(),
                packageVersion: pkgVersion,
                icfServiceVersion: icfVersion,
                topLevelCommandCount: topCmds.length,
                skillCount: skills.length,
                issueCount: issues.length,
                failedCount: failed.length,
                issues,
            },
            null,
            2,
        ) + '\n',
    );
} else {
    console.log('━━━ skills drift check ━━━');
    console.log(`package.json: ${pkgVersion}`);
    console.log(`ICF_SERVICE_VERSION: ${icfVersion}`);
    console.log(`顶层命令: ${topCmds.length}`);
    console.log(`skill: ${skills.length}`);
    console.log('');
    for (const i of issues) {
        const icon = i.ok ? '✓' : '✗';
        const color = i.ok ? '\x1b[32m' : '\x1b[31m';
        console.log(`${color}${icon}\x1b[0m ${i.label}`);
        if (!i.ok || process.env.VERBOSE === '1') {
            console.log(`    ${i.detail}`);
        }
    }
    console.log('');
    if (failed.length === 0) {
        console.log('\x1b[32m✓ 无漂移\x1b[0m');
    } else {
        console.log(`\x1b[31m✗ ${failed.length} 项漂移\x1b[0m`);
        if (!isFix) {
            console.log('   提示：跑 `node scripts/check-skills-drift.mjs --fix` 自动修复部分项');
        }
    }
}

process.exit(failed.length === 0 ? 0 : 1);