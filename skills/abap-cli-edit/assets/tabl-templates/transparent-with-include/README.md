# 透明表 + `.INCLUDE` 复用结构

适用：把审计字段（创建人/时间/修改人/时间）抽成 `zsample_reuse` STRU，多个表 `.INCLUDE` 复用。

## 三件套

- `zsample.tabl.json` — `formatVersion` + `header.description`
- `zsample.tabl.ddic` — `key client / key doc_id` + `include zsample_reuse;` + 增量字段
- `zsample.tabl.settings.json` — `generalInformation`

## 关键点

- **`include <stru_name>;` 必须以分号结尾**。CLI 解析器（[tabl-artifact.ts:parseTablDdic](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/dictionary/tabl-artifact.ts)）把它转成 `{ fieldName: '.INCLUDE', precField: 'ZSAMPLE_REUSE' }` 传给 SAP 端。
- **被 include 的 STRU 必须先在 SAP 里存在**（建议先 `abap create STRU <stru_name>`）。
- DDL 里 `include` 行**不**加缩进以外的特殊语法；不要写 `INCLU--AP` / `INCLUDE TYPE` 之类变体。
- `include` 后面还能继续加字段（如同例 `status`），CLI 会按 DDL 顺序把 `precField` 插在对应位置。

## 进阶：`.INCLU--AP`（append）

```abap
include zsample_reuse;  // 同步结构：被 include 的 STRU 改动会反映到本表
```

如果想用 append 模式（字段被复制到本表后独立维护，源 STRU 改动不再影响），SAP 语法是 `INCLUDE zsample_reuse AS extension` 或在事务 SE11 里「Append」标签。CLI 当前只支持同步 `include`（`precField`）；append 模式如需要走 ADT 路径。

## 使用

```bash
# 1. 先建被引用的 STRU
abap create STRU ZSAMPLE_REUSE --file src/stru/zsample_reuse.stru.json --package $TMP --yes

# 2. 复制整目录到目标位置
cp -r <skill-dir>/tabl-templates/transparent-with-include/* src/tabl/ztodo.tabl.{json,ddic,settings.json}
sed -i '' 's/zsample/ztodo/g' src/tabl/ztodo.tabl.{json,ddic,settings.json}

# 3. 创建
abap create TABL ZTODO --file src/tabl/ztodo.tabl.json --package $TMP --yes
```
