# 透明表 + 数量/单位对（`@Semantics.quantity.unitOfMeasure`）

适用：采购订单行项、销售订单数量、库存数量、批次数量等带度量单位的数量字段。

## 三件套

- `zsample.tabl.json` — `formatVersion` + `header.description`
- `zsample.tabl.ddic` — 关键在 `@Semantics.quantity.unitOfMeasure : 'zsample.unit'`
- `zsample.tabl.settings.json` — `generalInformation`

## 关键点

- **`@Semantics.quantity.unitOfMeasure : '<table>.<unit_field>'`**：告诉 SAP「这个 quan 字段的单位从同一表的 `<unit_field>` 取」。CLI 解析器把它转成 `{ refTable: 'ZSAMPLE', refField: 'UNIT' }`。
- `abap.quan(13, 3)` 两个参数：长度 13 + 小数 3 位（标准数量格式）。
- `abap.unit` 是度量单位（ISO unit code，如 `KG` / `M` / `L`），3 字符。

## 货币 vs 数量

| 字段类型 | DDL 数据类型 | 注释 | 用途 |
|---|---|---|---|
| 金额 | `abap.curr(15, 2)` | `@Semantics.amount.currencyCode` | 价格、金额、含税金额 |
| 数量 | `abap.quan(13, 3)` | `@Semantics.quantity.unitOfMeasure` | 订单数量、库存、批次 |

不要混用（金额字段挂 `@Semantics.quantity.*` 会让 SAP 报表取错换算关系）。

## 使用

```bash
cp -r <skill-dir>/tabl-templates/transparent-quantity-unit/* src/tabl/ztodo.tabl.{json,ddic,settings.json}
sed -i '' 's/zsample/ztodo/g' src/tabl/ztodo.tabl.{json,ddic,settings.json}
abap create TABL ZTODO --file src/tabl/ztodo.tabl.json --package $TMP --yes
```
