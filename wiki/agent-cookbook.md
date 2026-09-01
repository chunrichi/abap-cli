---
type: cookbook
title: Agent Cookbook — 端到端 SAP 开发剧本
description: AI agent 在 abap-cli 上完成常见 SAP 开发任务的最小可运行命令链。每个剧本：场景 → 完整命令序列 → 验证 → 失败兜底
tags: [abap-cli, agent, cookbook, end-to-end, scenarios]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# Agent Cookbook — 端到端 SAP 开发剧本

每个剧本是一个**最小可运行的命令序列**，从干净状态走到任务完成。**所有命令都加 `--json`**；Agent 通过 `status` / `error.code` 分支。

> 共同前置：`abap init --profile <name> --yes` 已执行；`.abap.json` 已存在。

## 剧本目录

| # | 场景 | 关键命令 |
|---|---|---|
| [1](#剧本-1修一个-bug) | 修一个 bug | `inspect → search → pull → edit → check syntax → push → run` |
| [2](#剧本-2加一个新域--表) | 加一个新域 + 元素 + 表 | `create DOMA → create DTEL → create TABL → activate TABL → select` |
| [3](#剧本-3跨系统同步) | 跨系统同步（PRD → DEV） | `pull → diff → push --tr` |
| [4](#剧本-4批量改-transport-内全部对象) | 批量改 transport 内全部对象 | `pull --tr NDK1 → sed → push --all --tr NDK1` |
| [5](#剧本-5试运行--不污染) | 试运行 + 不污染 transport | `create $TMP → push --tr $TMP → run → activate --tr 正式` |
| [6](#剧本-6紧急回滚) | 紧急回滚（生产事故） | `inspect --activation → transport list → 手动释放` |
| [7](#剧本-7新类--完整开发循环) | 新类（完整开发循环） | `create → pull → write body → check → push → run` |
| [8](#剧本-8删除对象) | 删除对象（极少用） | CLI 当前**未支持**；需 GUI |

---

## 剧本 1：修一个 bug

**场景**：用户报告「`ZCL_ORDER` 类的 `calculate_total` 方法计算错误」。

```bash
# 1. 探查
abap inspect ZCL_ORDER --structure --json        # 看类结构、确认 main part 在哪
abap where-used ZCL_ORDER --json                  # 影响面评估
abap search ZCL_ORDER --type CLAS --exact --json  # 确认唯一性

# 2. 拉取（含全部 include）
abap pull ZCL_ORDER --include-all-parts --json

# 3. 找 main part（一般是 implementations）
ls src/clas/zcl_order/

# 4. 修改 calculate_total 方法（agent 内部用编辑器工具改文件）
# ... edit src/clas/zcl_order/zcl_order.clas.implementations.abap ...

# 5. 推送前语法检查
abap check syntax src/clas/zcl_order/ --json     # 失败则不推

# 6. 推送（自动 lock → write → activate → unlock）
abap push src/clas/zcl_order/ --tr DEVK900001 --yes --json

# 7. 验证激活
abap inspect ZCL_ORDER --activation --json
# 期望：data.activation.ok === true

# 8. 跑（如果是 classrun）
abap run ZCL_ORDER --json
```

**失败兜底**：
- `LOCK_FAILED` → `abap inspect ZCL_ORDER --locks --json` 查持有者；SE03 手动释放
- `SYNTAX_ERROR` → 读 `data.errors[]` 修复
- `ACTIVATION_FAILED` → 同样读 `data.errors[]`，可能是引用的 DDIC 没激活

---

## 剧本 2：加一个新域 + 元素 + 表

**场景**：新增一个「订单状态」域 + 数据元素 + 透明表。

```bash
# 1. 先看是否已存在（防止命名冲突）
abap search ZORDER_STATUS --exact --json

# 2. 创建 DOMA
abap create DOMA ZORDER_STATUS \
  --file src/doma/zorder_status/zorder_status.doma.json \
  --package $TMP --description "Order status" --tr $TMP --yes --json

# 3. 创建 DTEL（引用上面的 DOMA）
abap create DTEL ZORDER_STATUS_DE \
  --file src/dtel/zorder_status_de/zorder_status_de.dtel.json \
  --package $TMP --description "Order status DE" --tr $TMP --yes --json

# 4. 创建 TABL（引用 DTEL）
#    准备 zorder_status.tabl.{json,ddic,settings.json} 三件套
abap create TABL ZORDER_TOTAL \
  --file src/tabl/zorder_total/zorder_total.tabl.json \
  --package $TMP --description "Order totals" --tr $TMP --yes --json

# 5. 激活 TABL（虽然 create 会自动激活，但确认一下）
abap activate ZORDER_TOTAL --json

# 6. 验证：能查表
abap select --table ZORDER_TOTAL --count-only --json
```

**失败兜底**：
- `DDIC_NOT_SUPPORTED` → 类型不在 4 种 DDIC 范围（DOMA/DTEL/TABL/STRU）
- `OBJECT_NOT_FOUND`（DTEL 创建后）→ DOMA 没激活；先 `activate ZORDER_STATUS`

---

## 剧本 3：跨系统同步（PRD → DEV）

**场景**：PRD 系统已经激活了对象，需要把同一份源码拉到 DEV 工作区做参考。

```bash
# 1. PRD profile（已在 .abap-cli/systems.json）
abap profile list --json  # 确认 PRD profile 名

# 2. 切换到 PRD profile（临时覆盖当前 workspace）
#    abap-cli 不支持单 workspace 多 profile；用户手动切换 .abap.json 的 system 字段
#    或 cd 到另一个目录执行 pull

# 3. 拉取 PRD 的 active 版本
abap pull ZCL_DEMO --remote PRD --json

# 4. 比对
abap diff src/clas/zcl_demo/ --json

# 5. 切回 DEV profile，再 push
abap push src/clas/zcl_demo/ --tr DEVK900001 --json
```

> `--remote` 走 ICF `/version-source`（TMS destination `TMSADM@<id>.DOMAIN_<id>`）。CLI 类型 → VRSD 类型映射：`PROG → REPS`、`INTF → INTF`、`CLAS → CLSD`（类定义）。

---

## 剧本 4：批量改 transport 内全部对象

**场景**：用户改了 N 个对象，要全部进同一 transport。

```bash
# 1. 拉取整个 transport 的对象
abap pull --tr NDK900001 --json

# 2. 用 sed / 脚本批量改（如替换所有 zcl_old_ 前缀）
# ... agent 内部 ...

# 3. 推送（--all 覆盖 src/ 下全部对象）
abap push --all --tr NDK900001 --atomic --yes --json

# 4. 验证
abap status --json
```

**失败兜底**：
- `--atomic` 模式下任何一个失败 → 整个 transport 回滚（已在 SAP 端）
- `OBJECT_LOCKED` → 单独 push 这个文件，先 unlock

---

## 剧本 5：试运行 + 不污染 transport

**场景**：写一个新方法想跑跑看，但不想污染生产 transport。

```bash
# 1. 在 $TMP 包下创建类（不进任何 transport）
abap create CLAS ZCL_TEST_NEW --package $TMP --description "test" \
  --tr $TMP --yes --json  # --tr $TMP 显式声明用本地 transport

# 2. 编辑 + 推送
abap pull ZCL_TEST_NEW --include-all-parts --json
# ... edit ...
abap push src/clas/zcl_test_new/ --tr $TMP --yes --json

# 3. 跑
abap run ZCL_TEST_NEW --json

# 4. 验证 OK 后，再正式 transport
abap pull ZCL_TEST_NEW --json  # 拉最新的 active 版本
# ... 调整 ...
abap push src/clas/zcl_test_new/ --tr DEVK900001 --yes --json

# 5. 清理：删除 $TMP 副本（CLI 未支持；用 SE80）
```

---

## 剧本 6：紧急回滚（生产事故）

**场景**：刚才 push 的代码导致生产 dump，需要快速回滚。

```bash
# 1. 看哪些对象是新激活的
abap inspect ZCL_BAD --activation --json
# data.activation.active 列出当前激活版本；data.activation.inactive 列出未激活

# 2. 看 ST22 dump（如果关联）
abap dumps --since 1h --json

# 3. 查找上一个 transport
abap transport list --recent --json
# 或：abap transport show DEVK900001 --json  # 看 transport 内对象列表

# 4. 回滚方案 A：在原 transport 内做反向修改
abap pull ZCL_BAD --json
# ... 写一个修复版本（不一定是回滚代码，可以是 fix-forward）...
abap push src/clas/zcl_bad/ --tr DEVK900001 --yes --json

# 5. 回滚方案 B：从 PRD 拉上一版本
abap pull ZCL_BAD --remote PRD --json  # PRD 是上一个未污染版本

# 6. 通知用户确认后推到 DEV
# ⚠️ CLI 当前不支持 `transport release`（dev/release）— 需要 GUI
```

**失败兜底**：`TRANSPORT_LOCKED` → SE01 手动解锁。

---

## 剧本 7：新类（完整开发循环）

**场景**：从零创建一个类，实现 `if_oo_adt_classrun~main`，跑通。

```bash
# 1. 接入就绪
abap doctor --json
abap transport list --open --json
abap extension status --json  # classrun 走 ADT，无需部署 wrapper

# 2. 确认不存在
abap search ZCL_NEW_CLASS --exact --json

# 3. 创建（用 minimal template）
abap create CLAS ZCL_NEW_CLASS --package $TMP --description "new" \
  --tr $TMP --template minimal --yes --json

# 4. 拉取（自动 create-then-pull 默认）
# 已经把骨架写进 src/clas/zcl_new_class/

# 5. 改 main part（用 public-method template）
cat src/clas/zcl_new_class/zcl_new_class.clas.abap
# ... 编辑文件，加上 if_oo_adt_classrun~main ...

# 6. 检查 + 推送
abap check syntax src/clas/zcl_new_class/ --json
abap push src/clas/zcl_new_class/ --tr $TMP --yes --json

# 7. 跑
abap run ZCL_NEW_CLASS --json
# data.stdout 是方法输出；data.exitCode 是 SAP 端业务退出码

# 8. ATC 静态检查
abap check atc src/clas/zcl_new_class/zcl_new_class.clas.abap \
  --variant Z_ATC_VAR --out ./atc.json --json

# 9. 验证激活
abap inspect ZCL_NEW_CLASS --activation --json
```

**失败兜底**：
- `WRAPPER_NOT_DEPLOYED` → 这个剧本走的是 classrun 不需要 wrapper；如果用 `--method` 才需要 wrapper
- `SYNTAX_ERROR` → 读 `data.errors[]` 修复
- `OBJECT_NOT_ACTIVE` → `abap activate ZCL_NEW_CLASS --yes`

---

## 剧本 8：删除对象（极少用）

CLI 当前**未实现** `abap delete`（见 [wiki/roadmap.md](roadmap.md) 第二节）。

绕过方案：
1. `abap pull <obj> --json`（保留源码副本）
2. 用 SAP GUI（SE80 / SE10）删除

不建议 agent 自动删除——属于不可逆操作。

---

# references

- 工作流编排：[`agents/abap-developer.agent.md`](../agents/abap-developer.agent.md)
- 全部命令：[`docs/commands.md`](../docs/commands.md)
- 错误码与退出码：[`wiki/output/exit-codes.md`](commands/path-output.md)（如不存在，看 `src/abap_cli/output/error-codes.ts`）
