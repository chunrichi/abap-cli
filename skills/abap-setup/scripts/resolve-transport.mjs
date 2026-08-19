#!/usr/bin/env node
// resolve-transport.mjs — 列可修改请求；没有则建一个。返回 transport 编号。
// 用法：resolve-transport.mjs [description] [package]
//   description 默认 "Agent work"
//   package 默认 "$TMP"
// 输出 stdout：transport 编号（如 DEVK900123）

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
            else resolve(stdout);
        });
    });
}

const desc = process.argv[2] ?? 'Agent work';
const pkg = process.argv[3] ?? '$TMP';

// 1. 看有没有可用的
let existing;
try {
    existing = await run(['transport', 'list', '--open', '--json']);
} catch {
    existing = '{"data":{"workbench":[]}}';
}
const list = JSON.parse(existing);
const first = list?.data?.workbench?.[0]?.number;
if (first) {
    process.stdout.write(first + '\n');
    process.exit(0);
}

// 2. 没有，建一个（写操作，需 --yes）
const created = await run(['transport', 'create', desc, '--package', pkg, '--yes', '--json']);
const createdJson = JSON.parse(created);
const num = createdJson?.data?.transport;
if (!num) {
    process.stderr.write(`abap transport create 未返回 transport 编号:\n${created}\n`);
    process.exit(1);
}
process.stdout.write(num + '\n');
