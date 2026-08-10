#!/usr/bin/env bash
# inspect-activation.sh — 诊断 + 修复 stale 激活（push 报 activated 但实际未激活）。
# 用法：./inspect-activation.sh <object>
# 自动：inspect --activation → 若 ok=false 调 activate --yes → 复检

set -euo pipefail

obj="$1"

echo "=== inspect --activation ==="
result=$(abap inspect "$obj" --activation --json)
ok=$(echo "$result" | jq -r '.data.activation.ok // false')

if [[ "$ok" == "true" ]]; then
    echo "激活状态 OK，无需修复"
    exit 0
fi

echo "发现 stale 激活："
echo "$result" | jq -r '.data.activation.parts[]? | "  - \(.includeType // "?") \(.sourceUri // "?") active=\(.active // "?")"'

echo "=== activate --yes ==="
abap activate "$obj" --yes --json

echo "=== 复检 ==="
abap inspect "$obj" --activation --json
echo "复检完成"