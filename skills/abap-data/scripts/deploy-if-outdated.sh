#!/usr/bin/env bash
# deploy-if-outdated.sh — 仅在 ICF 服务版本过期时才部署。
# 用法：./deploy-if-outdated.sh
# 退出码：0 部署成功或已是 current；1 部署失败；2 已是 current 跳过

set -euo pipefail

# 探测当前状态
status=$(abap doctor --json 2>/dev/null | jq -r '.data.icf // "unknown"')

if [[ "$status" == "current" ]]; then
    echo "ICF 服务已是 current，无需部署" >&2
    exit 2
fi

if [[ "$status" == "not_deployed" || "$status" == "outdated" ]]; then
    echo "ICF 状态: $status，开始部署" >&2
    abap deploy --yes --json
    exit 0
fi

echo "ICF 状态异常: $status" >&2
exit 1