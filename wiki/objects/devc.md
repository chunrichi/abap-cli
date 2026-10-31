---
type: object-type
title: DEVC — 包（Package）
description: DEVC 对象的 ADT 路由、devc-v1.json 字段契约、wire 字段映射、LOCAL 命名约束与 push 不支持的原因
tags: [abap-cli, object-type, devc, package, adt, abap-file-format]
created at: 2026-10-31 16:20:00
changed at: 2026-10-31 16:20:00
---

# DEVC — 包（Package）

## 路由（ADT 单通道）

| 操作 | 端点 |
|---|---|
| create | `POST /sap/bc/adt/packages`（body 是 `pak:package` XML） |
| preflight | `POST /sap/bc/adt/packages/validation` |
| pull | `GET /sap/bc/adt/packages/<name>`（`Accept: application/vnd.sap.adt.packages.v2+xml`） |
| delete | `DELETE /sap/bc/adt/packages/<name>` |
| push | **不支持** — ADT 资源控制器拒绝 `PUT /sap/bc/adt/packages/<name>` |

包是 ADT 上的一个**单资源**：没有 include、没有源码、没有激活步骤。registry 里 `source: 'ADT'`，但
不走通用的 "ABAP 源对象" 路径，而是 `flows/edit/{create,pull,delete}-devc.ts` 三个 handler；
`flows/edit/routing.ts` 的 `DEVC` 行只声明 create / pull（push 行缺失，且 registry 的
`pushUnsupportedReason` 给出明确拒绝原因）。

## 本地文件形态

```
src/
└── $tmp.devc.json            # 包名小写；命名空间包用括号 token
└── (accgo)acmcm_bw.devc.json # /ACCGO/ACMCM_BW
```

单文件，无侧车。schema 为上游 AFF `devc-v1.json`（vendored 到 `src/abap_cli/schema/`）。

## 文档形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "098 dev package",
    "originalLanguage": "en"
  },
  "generalInformation": {
    "type": "development",
    "superPackage": "ZLOCAL",
    "softwareComponent": "ZLOCAL",
    "supportsRecordChanges": true,
    "isAddingObjectsNotAllowed": true,
    "isEncapsulated": true,
    "defaultAbapLanguageVersion": "cloudDevelopment"
  },
  "useAccesses": [
    { "packageInterface": "SABP_MAIN_PUBLIC", "severity": "none" }
  ]
}
```

## wire → local 字段映射

映射实现在 `src/abap_cli/formats/devc/json.ts#wireToLocal`；`GET` 返回的 `pak:package` 属性来源：

| 本地字段 | wire 来源 |
|---|---|
| `header.description` | 根元素 `adtcore:description` |
| `header.originalLanguage` | 根元素 `adtcore:masterLanguage`（转小写） |
| `generalInformation.type` | `pak:attributes/@pak:packageType`（`development` / `main` / `structure`） |
| `generalInformation.superPackage` | `pak:superPackage/@adtcore:name` |
| `generalInformation.switch` | `pak:switch/@adtcore:name` |
| `generalInformation.applicationComponent` | `pak:applicationComponent/@pak:name`（空值省略） |
| `generalInformation.softwareComponent` | `pak:transport/pak:softwareComponent/@pak:name` |
| `generalInformation.transportLayer` | `pak:transport/pak:transportLayer/@pak:name` |
| `generalInformation.supportsRecordChanges` | `pak:attributes/@pak:recordChanges` |
| `generalInformation.isAddingObjectsNotAllowed` | `pak:attributes/@pak:isAddingObjectsAllowed` 取反 |
| `generalInformation.isEncapsulated` | `pak:attributes/@pak:isEncapsulated` |
| `generalInformation.defaultAbapLanguageVersion` | `pak:attributes/@pak:languageVersion`：`0`→`standard`、`2`→`keyUser`、`5`→`cloudDevelopment`、空→省略 |
| `useAccesses[].packageInterface` | `pak:useAccesses/pak:useAccess/pak:packageInterfaceRef/@adtcore:name` |
| `useAccesses[].severity` | `pak:useAccess/pak:severity` |

`pak:packageInterfaces` / `pak:translation` / `pak:subPackages` 是 ADT 的导航/值帮助信息，AFF 无对应字段，不落盘。

## 命令

```bash
# 建一个 $TMP 本地子包（LOCAL 软件组件 → 包名必须以 $ 或 TEST 开头）
abap create DEVC '$MY_PACKAGE' --package '$TMP' --description "Scratch package" --json

# 只做 SAP 侧预检（POST /packages/validation），不创建
abap create DEVC '$MY_PACKAGE' --package '$TMP' --description "Scratch package" --check-only --json

# 可传输包：显式软件组件 / 传输层 / 包类型
abap create DEVC ZPKG_SUB --package ZPKG_MAIN --description "Sub package" \
  --software-component HOME --transport-layer SAP --package-type main --tr NDK900123 --json

# 读回 / 删除
abap pull ZPKG_SUB --type DEVC --json
abap delete ZPKG_SUB --type DEVC --tr NDK900123 --yes --json
```

`--package` 对 DEVC 的含义是**父包（super package）**；软件组件 / 传输层缺省从父包继承（读一次父包
`GET /packages/<parent>`），`$TMP` 因此默认得到 `LOCAL` + 空 transport layer。create 成功后默认
create-then-pull，写 `src/<name>.devc.json`（`--no-pull` 关闭，`--overwrite` 控制是否覆盖已有草稿）。

## 命名规则

- 长度 ≤30；普通名字 `A-Z 0-9 _`，可带前导 `$`；命名空间形如 `/NS/NAME`（NS ≤10，总长 ≤30）。
- **软件组件为 `LOCAL` 时，包名必须以 `$` 或 `TEST` 开头**（SAP `packages/validation` 原文：
  `Names of LOCAL packages must start with '$' or 'TEST'`）。所以 `$TMP` 下建子包只能写
  `$MY_PACKAGE` / `TEST_MY_PACKAGE`，普通 `ZPKG` 在非 `$TMP` 父包下用。
- 本地预校验在写 SAP 前拦截非法形状；`--check-only` 例外——它把 LOCAL 前缀规则交给 SAP 判定并回显原文。

## 已知坑

- **push 不支持**：ADT 对包只有读 / 创建 / 删除，`PUT /sap/bc/adt/packages/<name>` 直接被资源控制器
  拒绝（`Resource controller does not support method PUT`）。`abap push src/*.devc.json` 报
  `TYPE_NOT_SUPPORTED`（exit 7）。改包的属性请用 SAP GUI，或 `delete` 后按新属性 `create`。
- **delete 不加锁**：包删除必须对**未加锁**的包执行；传 `lockHandle` 会被拒绝。命令实现是
  `DELETE`（transportable 包带 `corrNr`）。
- **stale 会话锁**：如果一个更早的 ADT 会话（通常是创建该包的命令会话）仍持有 enqueue 锁，SAP 会报
  "包 ... 已锁定"。`abap delete` 会自动 logout 一次、用新会话重试删除；仍失败说明锁属于其他用户。
- **不能删非空包**：包内还有对象或子包时 SAP 拒绝删除；先清空。
- **`$TMP` 的文件名**：`abap pull '$TMP' --type DEVC` 写出 `src/$tmp.devc.json`（`$` 保留在文件名里，
  命名空间才用括号 token）。
- **transportable 包的 delete 需要 `--tr`**：判定依据是包的软件组件——`LOCAL` 视为本地、无需 transport，
  其余（如 `HOME` / `ZLOCAL`）必须 `--tr`。

## 真机证据

在 S/4HANA（8.134.214.7:44300，profile `test`）验证：

- `pull` 三种形状：`$TMP`（LOCAL）、`ZDEV098`（superPackage + cloud 语言版本）、`/ACCGO/ACMCM_BW`
  （命名空间 + switch + applicationComponent + useAccesses + transportLayer）。
- `create` 在 `$TMP` 下真实建出 `$ZCLI_TC_PKG10`（201），自动落盘 `.devc.json`，二次 `pull` 为
  `skipped`（逐字节一致），`validate:aff` PASS，`delete` 成功后再 `pull` 为 404。
- `push` 明确报 `TYPE_NOT_SUPPORTED`（ADT 无更新端点）。
- 运行记录：`tests/261031002-realsap-devc/`（本地证据，不入库）。mock 侧端点形状见
  `test/integration/mock-adt/server.js` 与 `test/integration/devc-package-endpoints.test.ts`。

# references

- 类型矩阵：[object-types.md](../object-types.md)
- 命令页：[create](../commands/create.md) / [pull](../commands/pull.md) / [push](../commands/push.md) / [delete](../commands/delete.md)
- 上游格式：`file-formats/devc/devc-v1.json`（SAP/abap-file-formats）
