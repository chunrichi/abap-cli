#!/usr/bin/env node
// diagnose.mjs — 一次性跑 doctor + profile test，输出可解析结果。
// 用法：diagnose.mjs [<profile-name>]
// 不传 profile 时 doctor 检查默认 profile；profile test 跳过。

import { spawn } from 'node:child_process';

function run(args, { streamStdout = true } = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn('abap', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        const errChunks = [];
        proc.stdout.on('data', (c) => { chunks.push(c); if (streamStdout) process.stdout.write(c); });
        proc.stderr.on('data', (c) => errChunks.push(c));
        proc.on('error', reject);
        proc.on('close', (code) => {
            resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8') });
        });
    });
}

const profile = process.argv[2] ?? '';

console.log('=== doctor ===');
const doctor = await run(['doctor', '--json'], { streamStdout: false });
process.stdout.write(doctor.stdout);
if (!doctor.stdout.endsWith('\n')) process.stdout.write('\n');
if (doctor.code !== 0) {
    process.stderr.write('doctor 失败，查看 error.code 修复\n');
    process.exit(1);
}

if (profile) {
    console.log(`=== profile test ${profile} ===`);
    await run(['profile', 'test', profile, '--json']);
}

console.log('OK');
