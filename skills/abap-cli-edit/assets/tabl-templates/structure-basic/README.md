# STRU 纯字段（最常见 STRU 场景）

适用：被 `.INCLUDE` 引用的辅助结构、函数模块 / 类方法的入参 / 出参结构、ALV 字段目录等。

## 两件套（注意 STRU 无 settings）

- `zsample.stru.json` — `formatVersion` + `header.description`
- `zsample.stru.ddic` — `define structure zsample { ... }`，**不要**写 `.stru.settings.json`（SAP 不为 STRU 产生 settings；CLI 也接受，但留空文件会被解析报错）

## STRU vs TABL 关键差异

| 维度 | TABL | STRU |
|---|---|---|
| DDL 关键字 | `define table <name>` | `define structure <name>` |
| `@AbapCatalog.deliveryClass` | ✅ 必填 | ❌ 不要写（CLI 解析器不会检查，但写了也不会报错；语义上无意义） |
| `@AbapCatalog.enhancement.category` | ✅ 通常写 | ❌ 不要写 |
| `@AbapCatalog.tableCategory` | ✅ 必填 | ❌ 不要写 |
| `@AbapCatalog.dataMaintenance` | ✅ 通常写 | ❌ 不要写 |
| `key client : abap.clnt not null;` | ✅ 业务主键 | ❌ 不需要 key（结构无 key 概念） |
| `.tabl.settings.json` | 可选 | ❌ 不要写 |
| 字段前 `key` | 业务主键 | 不需要 |
| `@Semantics.*` | 适用 | 适用（语义注解同样有效） |

CLI 解析器（[tabl-artifact.ts:parseTablDdic](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/dictionary/tabl-artifact.ts)）根据 `define table` vs `define structure` 自动分流。

## 使用

```bash
cp -r <skill-dir>/tabl-templates/structure-basic/* src/stru/zsample.stru.{json,ddic}
sed -i '' 's/zsample/zsample_reuse/g' src/stru/zsample_reuse.stru.{json,ddic}
abap create STRU ZSAMPLE_REUSE --file src/stru/zsample_reuse.stru.json --package $TMP --yes

# 然后在 TABL/STRU 里 .INCLUDE 引用：
#   include zsample_reuse;
```
