#!/usr/bin/env bash
# diagnose.sh — 一次性跑 doctor + connection test，输出可解析结果。
# 用法：./diagnose.sh [<profile-name>]
# 不传 profile 时 doctor 检查默认 profile；connection test 跳过。

set -euo pipefail

profile="${1:-}"

echo "=== doctor ==="
if ! abap doctor --json; then
    echo "doctor 失败，查看 error.code 修复" >&2
    exit 1
fi

if [[ -n "$profile" ]]; then
    echo "=== connection test $profile ==="
    abap connection test "$profile" --json
fi

echo "OK"