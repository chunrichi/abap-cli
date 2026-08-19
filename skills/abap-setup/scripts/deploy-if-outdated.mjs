#!/usr/bin/env node
// deploy-if-outdated.mjs — 仅在 ICF 服务版本过期时才部署。
// 用法：deploy-if-outdated.mjs
// 退出码：0 部署成功或已是 current；1 部署失败；2 已是 current 跳过

import { spawn } from 'node:child_process';

function run(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('abap', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        const errChunks = [];
        proc.stdout.on('data', (c) => chunks.push(c));
        proc.stderr.on('data', (c) => errChunks.push(c));
        proc.on('error', reject);
        proc.on('close', (code) => {
            const stdout = Buffer.concat(chunks).toString('utf8');
            const stderr = Buffer.concat(errChunks).toString('utf8');
            if (code !== 0) reject(new Error(`abap exit ${code}: ${stderr.trim() || stdout.trim()}`));
            else resolve({ code, stdout, stderr });
        });
    });
}

let status = 'unknown';
try {
    const r = await run(['doctor', '--json']);
    const j = JSON.parse(r.stdout);
    status = j?.data?.icf ?? 'unknown';
} catch {
    // abap not on PATH / not initialized; fall through
}

if (status === 'current') {
    process.stderr.write('ICF 服务已是 current，无需部署\n');
    process.exit(2);
}

if (status === 'not_deployed' || status === 'outdated') {
    process.stderr.write(`ICF 状态: ${status}，开始部署\n`);
    await run(['extension', 'deploy', '--yes', '--json']);
    process.exit(0);
}

process.stderr.write(`ICF 状态异常: ${status}\n`);
process.exit(1);
