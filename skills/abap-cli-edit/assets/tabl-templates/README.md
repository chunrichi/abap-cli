# DDL 骨架（abap-file-format TABL/STRU）

LM Agent 写新 TABL/STRU 时**直接 cp 一个骨架到 `src/<typeFolder>/<name>.<type>.{json,ddic[,settings.json]}`，再 sed 重命名**。比凭空写 DDL 注释、`@AbapCatalog.*` 列表、`@Semantics.*` 配对等少踩 90% 坑。

## 5 个场景

| 场景 | 何时用 | 三件套 |
|---|---|---|
| [`transparent-key/`](transparent-key/) | 大部分客户表 / 主数据 / 配置表（client + 业务主键） | json + ddic + settings.json |
| [`transparent-with-include/`](transparent-with-include/) | 复用 audit 字段（created_by / created_at / ...）到多个表 | json + ddic + settings.json |
| [`transparent-currency-amount/`](transparent-currency-amount/) | 销售订单 / 采购订单 / 发票等带币别的金额 | json + ddic + settings.json |
| [`transparent-quantity-unit/`](transparent-quantity-unit/) | 采购数量 / 库存数量 / 批次数量等带度量单位 | json + ddic + settings.json |
| [`structure-basic/`](structure-basic/) | STRU（被 `.INCLUDE` 引用、ALV 字段目录、FM 入参/出参） | json + ddic（**无** settings） |

每个子目录有 `README.md` 描述使用场景、关键点、cp/sed 命令。

## 标准流程

```bash
# 1. 选骨架
ls <skill-dir>/tabl-templates/

# 2. cp 到目标位置
cp <skill-dir>/tabl-templates/transparent-key/* src/tabl/ztodo.tabl.{json,ddic,settings.json}

# 3. sed 重命名（小写）
sed -i '' 's/zsample/ztodo/g' src/tabl/ztodo.tabl.{json,ddic,settings.json}

# 4. 改 description、字段定义
$EDITOR src/tabl/ztodo.tabl.ddic

# 5. 创建
abap create TABL ZTODO --file src/tabl/ztodo.tabl.json --package $TMP --yes
```

## 跟 abap-file-format / DDL 解析器对齐

- 骨架里的 `@AbapCatalog.*` / `@EndUserText.label` / `@Semantics.*` 都用 SAP 标准语法；CLI 解析器（[src/abap_cli/dictionary/tabl-artifact.ts](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/dictionary/tabl-artifact.ts)）按 DDL 行序匹配注释到下一字段的元数据
- 关键类型（`abap.clnt` / `abap.curr(N,M)` / `abap.cuky` / `abap.quan(N,M)` / `abap.unit`）在 DDL 解析器白名单内；不在白名单的类型会抛 `TABL_DDL_INVALID`（exit 7）
- 命名空间 Z/Y/`/` 在 `validateDdicObject` 强校验；骨架默认用 `zsample`，重命名时记得大写
- 严格字段校验：用 [`schemas/tabl-v1.json`](schemas/tabl-v1.json) + [`schemas/tabt-v1.json`](schemas/tabt-v1.json)（官方 abap-file-format JSON Schema）跑 ajv（详见 [schemas/README.md](schemas/README.md)）；CLI 客户端校验是子集，ajv 是全字段校验

## 跟 CLI 命令对齐

- `abap create <type> <name> --file <main.json>`：happy path
- `abap pull <name> --type TABL`：从 SAP 拉同一布局的三件套（SAP 端 `zcl_abap_vibe_tabl_format` 产生，CLI 落盘）
- `abap push <main.json>`：推送整个三件套
- 详情见 [workflow.md 变体 2](../../references/workflow.md)
