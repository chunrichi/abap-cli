---
type: object-type
title: FUGR — 函数组（Function Group）
description: FUGR 对象的多文件布局、include 规则、function module 字段
tags: [abap-cli, object-type, fugr, abap-file-format, adt, fmodule]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# FUGR — 函数组（Function Group）

## 路由

**ADT**。FUGR 是 pull/push 最复杂的源对象类型，因为它是「多文件对象」。

## 本地文件形态

```
src/fugr/zfg_my_group/
├── zfg_my_group.fugr.json                       # 函数组元数据
├── zfg_my_group.fugr.saplzfg_my_group.reps.json # 函数池主程序元数据
├── zfg_my_group.fugr.saplzfg_my_group.reps.abap # 函数池主程序源码
├── zfg_my_group.fugr.lzfg_my_grouptop.reps.json # TOP include 元数据
├── zfg_my_group.fugr.lzfg_my_grouptop.reps.abap # TOP include 源码
├── zfg_my_group.fugr.lzfg_my_groupuxx.reps.abap # UXX include（FM→include-number 表）
├── zfg_my_group.fugr.zfm_first.func.json        # 第一个 FM 元数据
├── zfg_my_group.fugr.zfm_first.func.abap        # 第一个 FM 源码
├── zfg_my_group.fugr.zfm_second.func.json
└── zfg_my_group.fugr.zfm_second.func.abap
```

## 文件名约定

| 文件名模式 | 含义 |
|---|---|
| `<group>.fugr.json` | 函数组元数据（abap-file-format `fugr-v1.json`） |
| `<group>.fugr.sapl<group>.reps.*` | 函数池主程序（`FUGR source/main`） |
| `<group>.fugr.l<group>top.reps.*` | TOP include（全局数据声明） |
| `<group>.fugr.l<group>uxx.reps.abap` | UXX include（FM→include-number 映射表） |
| `<group>.fugr.l<group>u<NN>.reps.abap` | 第 NN 号 FUGR/I include |
| `<group>.fugr.<fm>.func.json` | FM 元数据（abap-file-format `fugr/func-v1.json`，**required 字段** `includeNumber`） |
| `<group>.fugr.<fm>.func.abap` | FM 源码 |

## 关键字段

`<group>.fugr.json` 必填字段：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My function group",
    "originalLanguage": "en"
  },
  "fixPointArithmetic": true
}
```

`<group>.fugr.<fm>.func.json` 必填字段（`includeNumber` 是 schema 必填，CLI 从 UXX 源码解析）：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My first FM",
    "originalLanguage": "en"
  },
  "functionModule": {
    "includeNumber": "01"
  }
}
```

## 命令示例

```bash
abap create FUGR ZFG_MY_GROUP --package $TMP --description "group" --tr $TMP --json
abap pull ZFG_MY_GROUP --json
abap push src/fugr/zfg_my_group/ --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 完全合规（CLI 实现拉/写 includeNumber 通过 UXX 反推）。

## 已知坑

- **UXX include 在 pull 时被自动跳过写入本地**（spec 要求），但 CLI 仍会读它来解析 `includeNumber`
- **`fixPointArithmetic`** 是 `fugr-v1.json` required；缺失时本地默认 `false`（见 `commands/pull.md` fixme B）
- **创建骨架会留 `<name>.fugr.abap`**（多余文件，应是 `sapl<name>.reps.abap`）—— 当前 create 路径的已知遗留
- **TEXT-POOL 不在 FUGR 内**：FUGR 的 textpool 走 `include` 内嵌，与 PROG/CLAS 分离

# references

- FUGR layout 实现：[`src/abap_cli/formats/fugr-layout.ts`](../../src/abap_cli/formats/fugr-layout.ts)
- 类型索引：[`wiki/objects/index.md`](index.md)
