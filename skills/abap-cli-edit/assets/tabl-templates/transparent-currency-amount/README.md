# 透明表 + 货币/金额对（`@Semantics.amount.currencyCode`）

适用：销售订单、采购订单、发票、应收应付等带币别的金额字段。

## 三件套

- `zsample.tabl.json` — `formatVersion` + `header.description`
- `zsample.tabl.ddic` — 关键在 `@Semantics.amount.currencyCode : 'zsample.currency'` 这条注释必须紧贴在 `amount` 字段上一行（DDL 注释通过行尾续行进入下一个字段的元数据）
- `zsample.tabl.settings.json` — `generalInformation`

## 关键点

- **`@Semantics.amount.currencyCode : '<table>.<currency_field>'`**：告诉 SAP「这个 curr 字段的币别从同一表的 `<currency_field>` 取」。CLI 解析器（[tabl-artifact.ts:parseTablDdic](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/dictionary/tabl-artifact.ts)）把它转成 `{ refTable: 'ZSAMPLE', refField: 'CURRENCY' }` 给 SAP 端。
- **缩进对齐注释行**：注释必须 `key client : abap.clnt not null;` 那种字段定义紧贴的**上一行**（同缩进或更左），用 `key client` 字段的列宽对齐，DDL 解析器按「注释 → 字段」配对。
- `abap.curr(15, 2)` 两个参数：长度 15 + 小数 2 位（标准金额格式）。
- `abap.cuky` 是币别码（currency key），3 字符 ISO 4217。
- 数量/单位对用 `transparent-quantity-unit/` 骨架（`@Semantics.quantity.unitOfMeasure`），**不要**复用本骨架。

## 使用

```bash
cp -r <skill-dir>/tabl-templates/transparent-currency-amount/* src/tabl/ztodo.tabl.{json,ddic,settings.json}
sed -i '' 's/zsample/ztodo/g' src/tabl/ztodo.tabl.{json,ddic,settings.json}
# 改 .tabl.ddic 时确保 @Semantics.amount.currencyCode 引用的字段名跟下一行一致
abap create TABL ZTODO --file src/tabl/ztodo.tabl.json --package $TMP --yes
```
