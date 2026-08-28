# 透明表 + 业务主键（最常见场景）

适用：客户表、配置表、主数据表。

## 三件套

- `zsample.tabl.json` — `formatVersion` + `header.description`
- `zsample.tabl.ddic` — `@AbapCatalog.*` 注释 + `define table zsample { key client : abap.clnt not null; ... }`
- `zsample.tabl.settings.json` — `generalInformation.{dataClassCategory, sizeCategory}`

## 关键点

- **`key client` 必须放第一行**（SAP 透明表约定）。CLI 解析时把 `CLIENT`/`MANDT` 从 `fields[]` 丢弃（SAP 端 `zcl_abap_vibe_ddic` 会在 `clientDependent: true` 时自动 prepend 一个 MANDT）。**不要**在 DDL 里写第二个 `key client` 或 `key mandt`。
- 其它 `key` 字段紧跟 `key client`，可多可少（`key customer_id` 是业务主键）。
- `@AbapCatalog.deliveryClass : #A` 是「应用表」最常见的取值；其它取值：`#C`（客户定制）、`#L`（临时存储）、`#W`（系统表，如 STXL）。
- `@AbapCatalog.dataMaintenance : #RESTRICTED` 是默认（SM30 维护需要显式打开）；`#NOT_ALLOWED` 用于纯查询表。

## 使用

```bash
# 1. 复制整目录到目标 src/<typeFolder>/
cp -r <skill-dir>/tabl-templates/transparent-key/* src/tabl/ztodo.tabl.{json,ddic,settings.json}
# 2. 把所有 zsample 改成你的对象名（小写）
sed -i '' 's/zsample/ztodo/g' src/tabl/ztodo.tabl.{json,ddic,settings.json}
# 3. 改 ztodo.tabl.ddic 里的字段定义 + ztodo.tabl.json 的 description
# 4. 创建
abap create TABL ZTODO --file src/tabl/ztodo.tabl.json --package $TMP --yes
```
