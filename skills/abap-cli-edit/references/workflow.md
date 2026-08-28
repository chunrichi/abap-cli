# abap-cli-edit — 详细工作流

> 按需加载。本文件展开 SKILL.md 决策树，处理各种变体（FUGR / DDIC / 包批量 / 远程 / stale 激活修复 / where-used）。select 翻页走 [abap-cli-data] 的 `scripts/pages-select.mjs`。

## 变体 1 — FUGR（Function Group）

FUGR 子对象（FM、include）是独立 ADT 锁对象，**与 CLAS/PROG/INTF 的对象锁模型不同**。

```bash
# 拉
abap pull ZFG --type FUGR
# → src/zfg/
#    ├── zfg.fugr.json
#    ├── zfg.fugr.abap                          # main
#    ├── zfg.fugr.saplzfg.reps.abap             # function-pool
#    ├── zfg.fugr.lzfgtop.reps.abap             # TOP include
#    └── zfg.fugr.<fm>.func.abap                # 每个 FM

# 改 + 推
abap push src/zfg/zfg.fugr.<fm>.func.abap --tr DEVK900001
# 每个文件锁自己的目标（group / include / FM），最后激活整个 group
```

UXX include 由系统生成，**不**在 pull 范围内——`abap pull` 自动跳过。

## 变体 2 — DDIC 定义（DOMA / DTEL / TABL / STRU）

走 ICF 服务 `/ddic/<type>`，与 ADT 链路完全独立。

### TABL / STRU：abap-file-format 三件套（happy path）

**LM Agent 写新表时**：直接 `cp` 一份 [assets/tabl-templates/](../assets/tabl-templates/) 里的骨架到 `src/<typeFolder>/`，sed 重命名 + 编辑字段即可。5 个场景覆盖 90% 需求（透明表 / include / 货币金额 / 数量单位 / STRU）。

`--file` 指向 main JSON（`<name>.tabl.json`），CLI 自动读取同目录的同名 `<name>.tabl.ddic`（DDL 源）与 `<name>.tabl.settings.json`：

| 文件 | 必填 | 内容 |
|---|---|---|
| `<name>.tabl.json` | ✅ | `formatVersion` + `header.{description, originalLanguage, abapLanguageVersion}`（**无** `name` / `fields`） |
| `<name>.tabl.ddic` | ✅ | DDL 源（`@AbapCatalog.*` 注释 + `define table|structure <name> { ... }`） |
| `<name>.tabl.settings.json` | ❌ | `generalInformation.{dataClassCategory, sizeCategory, ...}` |

```bash
# 拉 — SAP 端 zcl_abap_vibe_tabl_format 产生三件套，CLI 落盘
abap pull ZT_X --type TABL --overwrite     # 落 src/tabl/zt_x.tabl.json + .tabl.ddic (+ .tabl.settings.json)

# 建 — CLI 解析三件套，wire payload 推 /ddic/tabl
cat > src/tabl/zt_x.tabl.json <<'EOF'
{
  "formatVersion": "1",
  "header": { "description": "Example", "originalLanguage": "en" }
}
EOF
cat > src/tabl/zt_x.tabl.ddic <<'EOF'
@EndUserText.label : 'Example'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zt_x {
  key client : abap.clnt not null;
  key id     : abap.char(10) not null;
}
EOF
# 可选
cat > src/tabl/zt_x.tabl.settings.json <<'EOF'
{
  "formatVersion": "1",
  "generalInformation": { "dataClassCategory": "APPL0", "sizeCategory": "0" }
}
EOF
abap create TABL ZT_X --file src/tabl/zt_x.tabl.json --package $TMP --yes

# 推
abap push src/tabl/zt_x.tabl.json --tr DEVK900001 --yes   # 也可 --all 推整个 src/
```

### TABL/STRU 兼容：legacy wire-flat 单文件

只有 main `<name>.tabl.json`（无 `.tabl.ddic` sidecar）时，CLI 回落 014 既有的 wire-flat 解析（顶层 `name` / `description` / `fields[]`）。**新文件应统一用三件套**（DDL 是字段源真值、`dataClassCategory` / `sizeCategory` 在 settings.json 里）。

### DOMA / DTEL：单文件 wire-flat

```bash
abap pull ZD_X --type DOMA                  # 落 src/doma/z_d_x.doma.json
abap create DOMA ZD_X --file src/doma/z_d_x.doma.json --tr DEVK900001 --yes
abap push src/doma/z_d_x.doma.json --tr DEVK900001 --yes
abap push src/doma/z_d_x.doma.json               # $TMP 无需 --tr
```

### 客户端校验（`validateDdicObject`）

- 命名空间必须 `Z`/`Y`/`/` 开头（客户命名空间）
- 必填字段（依 type 而异）：TABL/STRU 至少 `fields[]` 非空；DOMA 至少 `dataType` + `length`；DTEL 至少 `description` + (`domain` 或 `dataType`)
- 非 `$TMP` 包必须 `--tr`

错误码：`DDIC_NOT_SUPPORTED` / `TABL_DDL_INVALID`（三件套 DDL 解析错）/ `INVALID_FIELD` / `MISSING_FIELD` / `INVALID_NAMESPACE` / `VALIDATION_ERROR`。schema 与 example：见 `abap create <type> --schema` 的 `exampleJson` 字段（三件套形态）与 `error.example`（legacy wire-flat fallback 提示）。

## 变体 3 — 包批量

```bash
# 单页
abap pull --package ZDEV --limit 50 --page 1

# 全量（CI 友好）
abap pull --package ZDEV --limit 100 | jq -r '.data.results[].name' > objects.txt
while read -r obj; do
    abap pull "$obj" --json
done < objects.txt
```

`--limit` 默认 20（包批量），`--page-all` 在 search 里有但 pull 没有——需要脚本循环。

## 变体 4 — 远程版本（Version Management）

```bash
abap pull ZCL_FOO --remote PRD
# → src/zcl_foo/zcl_foo.clas.abap（active 00000）
# → data.remote: 'PRD', data.version: '00000'
```

走 ICF `/version-source`，需 TMS RFC destination `TMSADM@<id>.DOMAIN_<id>` 可达。**仅**拉 active 版本。

类型映射：

| CLI type | Version Mgmt type |
|---|---|
| PROG | REPS |
| INTF | INTF |
| CLAS | CLSD（class definition） |

其他类型报 `TYPE_NOT_SUPPORTED` / `VERSION_DESTINATION_INVALID`。

## 变体 5 — Stale 激活修复

`push` 报 activated 但 `inspect --activation` 报 `ok: false`——method/OSI 层级没激活（013 落地经验，root-URI `activate` 在真实 SAP 上静默 no-op）。

```bash
# 1. 诊断
abap inspect ZCL_FOO --activation --json
# → data.activation: { ok: false, parts: [{ includeType, sourceUri, active }] }

# 2. 修复
abap activate ZCL_FOO --yes --json
# → data.activated: <n>

# 3. 复检
abap inspect ZCL_FOO --activation --json
# → data.activation.ok: true
```

匹配规则：`uri.split('#')[0] === objectUrl`（method/OSI 项带 `#fragment`，inactive 项必须严格匹配对象部分，避免 `ZCL_FOO_BAR` 被前缀误判为 `ZCL_FOO`）。

## 变体 6 — 链式 sync 已移除

```bash
abap sync
# → USAGE: abap sync 已移除（021 决策）
#       用: abap status --json / abap pull / abap push --yes
```

Agent 显式编排 `status → pull / push`，冲突保护机制一致：单边改 → 自动同步；双边改 → `data.conflicts[]` 列出，agent 决策。

## 变体 7 — 离线草稿

```bash
abap create local CLAS ZCL_NEW --dir ./src
# → src/zcl_new/zcl_new.clas.abap（默认骨架）
# 零 SAP 调用，无凭证读取
```

落地后 → `abap create CLAS ZCL_NEW --no-pull` 在 SAP 建空对象 → `abap push` 推草稿。

## 变体 8 — textpool

```bash
# 拉
abap pull ZCL_FOO --textpool
# → src/zcl_foo/zcl_foo.texts.en.properties
# → src/zcl_foo/zcl_foo.selections.en.properties
# → src/zcl_foo/zcl_foo.headings.en.properties

# 改
# 编辑 .properties

# 推
abap push src/zcl_foo/zcl_foo.texts.en.properties
```

混合模式：ADT 文本元素 API 可用时走 ADT，否则 ICF `/textpool/*`。能力在 `profile add/set` 时**一次探测**并缓存到 profile 的 `adtTextpool`，后续直接读缓存路由，无运行时回退。JSON 结果 `data.route: 'adt' | 'icf'`。

## 变体 9 — FUGR 包含错误

`.clas.macros.abap` 只有在对象**确实有** macros include 时才能推；对象没有该 include 时**报错**（`SAP_ERROR` exit 6，`subtype` + `nextSteps` 指向 `inspect --includes`），**不**静默回退把 macros 内容写进 main。只有 `main` 文件映射到对象的 main part。

## 变体 10 — where-used 重构冲击评估

```bash
# 评估 ZCL_FOO 改名 / 删方法前的直接影响面
abap where-used ZCL_FOO --type CLAS --limit 500 --json
# → data.references[]: [{ objectUrl, objectType, name, packageName }, ...]
```

- **支持的类型**：`CLAS` / `INTF` / `PROG` / `FUGR` / `TABL`
- **默认 limit**：`100`；最大 `500`
- **输出**：`data.references[i].objectUrl` 可直接喂给 `abap pull`
- **未索引**：报 `OBJECT_NOT_INDEXED`——回退用 `search` + 本地代码搜索

使用模式：

```bash
# 1. 评估冲击
refs=$(abap where-used ZCL_FOO --type CLAS --limit 500 --json | jq -r '.data.references[].objectUrl')

# 2. 拉每个引用方到本地审视
echo "$refs" | head -20 | while read url; do
    abap pull "$url" --json
done

# 3. 修改完后 push
```

## 变体 11 — select 翻页

```bash
# 单页 + 翻页（按 ID 升序保证稳定）
abap select --table ZT_FOO --fields "ID,STATUS" --order-by "ID:ASC" --limit 100 --offset 0
abap select --table ZT_FOO --fields "ID,STATUS" --order-by "ID:ASC" --limit 100 --offset 100

# 全量（用辅助脚本）
node ./scripts/pages-select.mjs ZT_FOO --where "STATUS = 'X'" --order-by "ID:ASC" --page-size 200

# 仅计数（最快）
abap select --table ZT_FOO --where "AMOUNT > 100" --count-only
```

`data.truncated: true` 表示还有后续页。`--count-only` 走 `COUNT(*)` SQL，不取明细。
