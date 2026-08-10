#!/usr/bin/env bash
# resolve-transport.sh — 列可修改请求；没有则建一个。返回 JSON。
# 用法：./resolve-transport.sh [description] [package]
#   description 默认 "Agent work"
#   package 默认 "$TMP"
# 输出 stdout：transport 编号（如 DEVK900123）

set -euo pipefail

desc="${1:-Agent work}"
pkg="${2:-\$TMP}"

# 1. 看有没有可用的
existing=$(abap transport list --open --json 2>/dev/null || echo '{"data":{"workbench":[]}}')
workbench=$(echo "$existing" | jq -r '.data.workbench[0].number // empty')

if [[ -n "$workbench" ]]; then
    echo "$workbench"
    exit 0
fi

# 2. 没有，建一个（写操作，需 --yes）
new=$(abap transport create "$desc" --package "$pkg" --yes --json)
echo "$new" | jq -r '.data.transport'