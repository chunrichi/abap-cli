# CLI Output Layer (`src/abap_cli/output/`)

Unified output + error contract. Every command renders through this layer so
`--json` envelopes, exit codes, and human text stay consistent (012).

## 渲染链路（一个错误从抛出到退出码）

```mermaid
graph LR
    A[命令层 action] -->|throw CliError| B[printError<br/>output/json.ts]
    B --> C{json?}
    C -->|yes| D[JSON 信封<br/>status=error + meta + error]
    C -->|no| E[human 错误文本<br/>stderr]
    B --> F[exitCodeFor<br/>output/exit-codes.ts]
    A -->|printResult| G[成功信封<br/>status=success + meta + data]
    D --> H[stdout 空<br/>错误走 stderr]
```

Top-level commander 错误（unknown command / missing arg / unknown option）不经过
`printError`，而是由 [../top-error.ts](../top-error.ts) 的 `handleTopLevelError`
统一处理，再路由到 `renderError`。

## 文件职责

| 文件 | 职责 |
|------|------|
| [error-codes.ts](error-codes.ts) | `ErrorCode` 枚举 + `ErrorCategory` 分类（单一事实来源 FR-008） |
| [exit-codes.ts](exit-codes.ts) | 分类 → 退出码映射（0–9，稳定契约，改码需扩展合同文档） |
| [json.ts](json.ts) | `CliError` 类、`printResult` / `printError` / `renderError`、`printSchema`、`jsonFromCommand`、`CommandSchema` 类型 |
| [meta.ts](meta.ts) | 信封 `meta` 块（command/version/timestamp/durationMs/warnings）+ `collectWarning` / `originalArgv` |
| [help-text.ts](help-text.ts) | `commonErrorsAfter()`：挂在每个命令 `--help` 尾部的错误码/退出码表 |
| [issues.ts](issues.ts) | `CheckIssue` 输出数据模型（check 命令的 finding，不涉及错误信封） |

## 关键约定

- **`CliError` 是唯一用户可见错误类型**：命令边界（`commands/`、`flows/`、
  `config/`、`formats/`、`clients/`、`core/`、`textpool/`、`dictionary/`、
  `icf/`）抛出的必须构造 `CliError`，由 `test/unit/cli-error-boundary.test.ts` 强制。
- **退出码稳定性**：`EXIT_CODES` 的值跨版本不变；新增分类只能占用保留区间
  （≥10）或走合同扩展。`help-text.ts` 的表与 `EXIT_CODES` 必须同步。
- **warning ≠ error**：非致命问题（如解锁失败、ICF 探测降级）走
  `meta.warnings`（`collectWarning`），永不出现在错误信封里。
- **stdout/stderr 分离**：`--json` 失败时 stdout 必须为空，信封 + 帮助体走
  stderr（详见 `../top-error.ts` 注释与 `test/unit/output-streams.test.ts`）。
- **变更提示**：改错误码表时同时更新 `error-codes.ts`、`exit-codes.ts`、
  `help-text.ts` 和 `specs/012-unify-cli-output-contract/contracts/cli-output.md`。
