#!/usr/bin/env bash
# select-table.sh — 包装 abap select，给 agent 用的便捷脚本（自动分页 + 截断）。
# 用法：./select-table.sh <table> [--where <clause>] [--fields <csv>] [--page-size <n>]
# 退出码：0 全部取完；非 0 出错

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "用法: $0 <table> [--where <clause>] [--fields <csv>] [--page-size <n>]" >&2
    exit 2
fi

table="$1"
shift

where=""
fields=""
page_size=100
order_by=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --where) where="--where $2"; shift 2 ;;
        --fields) fields="--fields $2"; shift 2 ;;
        --page-size) page_size="$2"; shift 2 ;;
        --order-by) order_by="--order-by $2"; shift 2 ;;
        *) echo "未知参数: $1" >&2; exit 2 ;;
    esac
done

offset=0
total=0
while :; do
    result=$(abap select \
        --table "$table" \
        $where \
        $fields \
        $order_by \
        --limit "$page_size" \
        --offset "$offset" \
        --json)

    rows=$(echo "$result" | jq -r '.data.rows // []')
    count=$(echo "$result" | jq -r '.data.rowCount // 0')
    truncated=$(echo "$result" | jq -r '.data.truncated // false')

    echo "$rows" | jq -c '.[]'

    total=$((total + $(echo "$rows" | jq 'length')))

    if [[ "$truncated" != "true" ]]; then
        break
    fi
    offset=$((offset + page_size))
done

echo "总行数: $total" >&2