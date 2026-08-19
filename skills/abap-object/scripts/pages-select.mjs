#!/usr/bin/env node
// pages-select.mjs — 包装 `abap select` 给 agent 用的便捷脚本（自动分页 + 截断）。
// 用法：pages-select.mjs <table> [--where <clause>] [--fields <csv>] [--page-size <n>] [--order-by <pair>]
// 退出码：0 全部取完；2 用法错；非 0 abap 调用失败
//
// 依赖：Node 18+（使用 fetch / Readable / TextDecoder / core ESM）

import { spawn } from 'node:child_process';

const USAGE = '用法: pages-select.mjs <table> [--where <clause>] [--fields <csv>] [--page-size <n>] [--order-by <pair>]';

function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length < 1) {
        process.stderr.write(`${USAGE}\n`);
        process.exit(2);
    }
    const table = args[0];
    const opts = { where: '', fields: '', orderBy: '', pageSize: '100' };
    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === '--where') { opts.where = String(args[++i] ?? ''); }
        else if (a === '--fields') { opts.fields = String(args[++i] ?? ''); }
        else if (a === '--order-by') { opts.orderBy = String(args[++i] ?? ''); }
        else if (a === '--page-size') { opts.pageSize = String(args[++i] ?? ''); }
        else {
            process.stderr.write(`未知参数: ${a}\n`);
            process.exit(2);
        }
    }
    return { table, opts };
}

function quoteArg(value, pattern) {
    // 仅当参数含 shell 元字符且未带引号时给 args 转义，避免破坏 abap 的 csv/where 语法
    return pattern.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value;
}

function runAbapSelect({ table, where, fields, orderBy, pageSize, offset }) {
    return new Promise((resolve, reject) => {
        const args = [
            'select',
            '--table', table,
            '--limit', pageSize,
            '--offset', String(offset),
            '--json',
        ];
        // 客户端预解析 csv/where，避免 shell 解析破坏引号
        if (fields) args.push('--fields', fields);
        if (where) args.push('--where', where);
        if (orderBy) args.push('--order-by', orderBy);

        const proc = spawn('abap', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        const errChunks = [];
        proc.stdout.on('data', (c) => chunks.push(c));
        proc.stderr.on('data', (c) => errChunks.push(c));
        proc.on('error', reject);
        proc.on('close', (code) => {
            const stdout = Buffer.concat(chunks).toString('utf8');
            const stderr = Buffer.concat(errChunks).toString('utf8');
            if (code !== 0) {
                reject(new Error(`abap select exit ${code}: ${stderr.trim() || stdout.trim()}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error(`abap select 输出非 JSON: ${e.message}\n${stdout.slice(0, 200)}`));
            }
        });
    });
}

async function main() {
    const { table, opts } = parseArgs(process.argv);
    let offset = 0;
    const pageSize = parseInt(opts.pageSize, 10);
    if (!Number.isFinite(pageSize) || pageSize < 1) {
        process.stderr.write(`--page-size 必须是正整数 (got '${opts.pageSize}')\n`);
        process.exit(2);
    }

    let total = 0;
    while (true) {
        const env = await runAbapSelect({ table, ...opts, pageSize: String(pageSize), offset });
        const data = env.data ?? {};
        const rows = Array.isArray(data.rows) ? data.rows : [];
        for (const row of rows) {
            process.stdout.write(JSON.stringify(row) + '\n');
        }
        total += rows.length;
        if (data.truncated !== true) break;
        offset += pageSize;
    }
    process.stderr.write(`总行数: ${total}\n`);
}

main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
});
