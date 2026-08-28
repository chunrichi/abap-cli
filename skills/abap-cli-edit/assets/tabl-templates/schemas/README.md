# abap-file-format 官方 JSON Schema

直接 copy 自 [SAP/abap-file-formats `tabl/`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/tabl)，版本对应 main branch `2026-08-28`（项目 mirror 在 `tmp/abap-file-formats/file-formats/tabl/`）。

## 文件

| Schema | 用途 | 大小 |
|---|---|---|
| `tabl-v1.json` | main `.tabl.json` / `.stru.json` 校验（`formatVersion` + `header`） | 1.8 KB |
| `tabt-v1.json` | `.tabl.settings.json` 校验（`generalInformation` + 可选 `buffering` + `dbSpecificSettings`） | 6.6 KB |

`.tabl.ddic` / `.stru.ddic` 是 ABAP DDL 源码，**没有** JSON schema（CLI 解析器 [src/abap_cli/dictionary/tabl-artifact.ts:parseTablDdic](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/dictionary/tabl-artifact.ts) 是手写 lexer）。

## 用 ajv 在本地校验 main / settings

官方 schema 用 [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema)；ajv ≥ 8 内置支持，**必须**走 `ajv/dist/2020` 入口（默认入口是 draft-07，会报 `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`）。

```bash
npm install --no-save ajv@8 ajv-formats
# 注意：用 .default 解构 ESM-only export
node -e '
const Ajv = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateMain = ajv.compile(require("./tabl-v1.json"));
const validateSettings = ajv.compile(require("./tabt-v1.json"));
const main = require("./src/tabl/ztodo.tabl.json");
const settings = require("./src/tabl/ztodo.tabl.settings.json");
console.log(validateMain(main) ? "main OK" : "main INVALID: " + JSON.stringify(validateMain.errors, null, 2));
console.log(validateSettings(settings) ? "settings OK" : "settings INVALID: " + JSON.stringify(validateSettings.errors, null, 2));
'
```

5 个骨架（[../README.md](../README.md)）+ 官方 example（[zaffexample.tabl.json](https://github.com/SAP/abap-file-formats/blob/main/file-formats/tabl/examples/zaffexample.tabl.json)）已通过 ajv 校验，**CI 可以参考**这条命令做 regression。

Agent 可以在写完三件套后跑这条命令自我验证 main / settings 合规；DDL 走 CLI 解析器（`abap create` 触发，错时 `TABL_DDL_INVALID` exit 7）。

## 与本仓库其它位置的关系

- **CLI 客户端校验**：[`validateDdicObject()`](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/dictionary/ddic-json.ts) 是 hand-rolled 的子集校验（`name` namespace + TABL `fields[]` / DOMA `dataType+length` / DTEL `description+domain`），只覆盖 abap-file-format 的「CLI 能用」子集，**不**做 schema-level 全字段校验。Agent 需要严格字段校验就上 ajv 跑这两个 schema。
- **SAP 端最终校验**：`zcl_abap_vibe_ddic` 会按 abap-file-format 规范完整校验（含 settings / buffering / dbSpecificSettings）；所以**通过了 ajv 不等于 SAP 一定接受**（SAP 还有 DDL-side、ABAP runtime-side 的检查），通过了 SAP 校验才是 ground truth。
- **同步策略**：本目录下的 schema 是从官方仓库 copy，**手动**同步。当 `tmp/abap-file-formats/` 拉新版本时跑：

```bash
cp ../../../../tmp/abap-file-formats/file-formats/tabl/tabl-v1.json .
cp ../../../../tmp/abap-file-formats/file-formats/tabl/tabt-v1.json .
git diff  # 看 schema 字段增减
```

如果官方有 breaking 变更（如 `header` 加 `abapLanguageVersion` 必填），CLI 解析器、create 流程、5 个骨架都要跟着改。**AGENTS.md** "Refactor Fearlessly" 允许 breaking，但要在 CHANGELOG 记录 schema 版本。
