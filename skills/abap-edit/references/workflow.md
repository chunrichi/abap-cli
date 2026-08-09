# abap-edit — 详细工作流

> 按需加载。本文件展开 SKILL.md 决策树，处理各种变体（FUGR / DDIC / 包批量 / 远程 / stale 激活修复）。

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

```bash
# 拉
abap pull ZT_X --type TABL                  # 落 src/z_x.tabl.json
abap pull ZD_X --type DOMA                  # 落 src/z_d_x.doma.json

# 建（基于 JSON）
abap create TABL ZT_X --file ./zt_x.tabl.json --tr DEVK900001

# 推
abap push src/z_x.tabl.json --tr DEVK900001
abap push src/z_d_x.doma.json               # $TMP 无需 --tr
```

客户端校验（`validateDdicObject`）：

- 命名空间必须 `Z`/`Y` 开头（客户命名空间）
- 必填字段（依 type 而异）
- `transportRequest` 字段（推送时回退）

错误码：`DDIC_NOT_SUPPORTED` / `INVALID_FIELD` / `MISSING_FIELD` / `INVALID_NAMESPACE`。

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

## 变体 6 — sync 链式

```bash
# 默认 status（只读，不改任何东西）
abap sync

# 拉 missing
abap sync --pull --yes

# 推 divergent（冲突保护：本地与 SAP 都改了的，绝不静默覆盖）
abap sync --push --yes
```

冲突处理：单边改 → 自动同步；双边改 → `data.conflicts[]` 列出，agent 决策。

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

混合模式：ADT 文本元素 API 可用时走 ADT，否则 ICF `/textpool/*`。能力在 `connection add/set` 时**一次探测**并缓存到 profile 的 `adtTextpool`，后续直接读缓存路由，无运行时回退。JSON 结果 `data.route: 'adt' | 'icf'`。

## 变体 9 — FUGR 包含错误

`.clas.macros.abap` 只有在对象**确实有** macros include 时才能推；对象没有该 include 时**报错**（`SAP_ERROR` exit 6，`subtype` + `nextSteps` 指向 `inspect --includes`），**不**静默回退把 macros 内容写进 main。只有 `main` 文件映射到对象的 main part。