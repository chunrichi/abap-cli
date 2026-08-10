#!/usr/bin/env bash
# validate-push.sh — 推送前 dry-run + check 校验，给 agent 一个"安全预演"。
# 用法：./validate-push.sh <file> [--tr <transport>]
# 退出码：0 全部 OK；非 0 校验失败

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "用法: $0 <file> [--tr <transport>]" >&2
    exit 2
fi

file="$1"
shift

# 1. syntax check
echo "=== check --syntax ==="
abap check "$file" --syntax --json
echo "语法 OK"

# 2. dry-run push
echo "=== push --dry-run ==="
abap push "$file" --dry-run "$@" --json
echo "推送计划 OK"

echo "全部预演通过 — 可以执行真 push（去掉 --dry-run 即可）"