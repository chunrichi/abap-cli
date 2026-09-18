# abap-cli feedback 核验报告

> 对 `abapcli_whichchanged/docs/abap-cli-feedback.md`（F-01 … F-30）逐条核验：
> 问题是否**真实存在**、根因在**客户端 TS / 自带 ICF ABAP 服务 / SAP 内核 / 本机环境**的哪一层、
> 以及是否已在当前代码里修掉。
>
> 核验日期：2026-09-18 ｜ 核验对象：仓库 `dev` 分支 HEAD `0452193`（`git describe` = `v0.2.6-41-g0452193`），
> 构建产物 `dist/`（2026-09-18 08:24 构建，含 HEAD 全部提交），CLI `--version` 报 `0.2.6`。
> live 系统：`vhcala4hci:50000` client `001` user `developer`（即反馈里的 A4H）。
> 另有端到端核验：npm registry 上的**已发布包** `abap-cli@0.2.7`（安装在 `/tmp`，不影响本机全局安装）。

---

## 0. 一句话结论

反馈整体质量很高：**30 条里 23 条完全证实、6 条部分证实、1 条不成立**（F-20），另有若干条把
"客户端缺陷 / 自带 ICF ABAP 服务缺陷 / SAP 内核限制 / 本机沙箱环境"混在了一起，需要分层归位。

最重要的两条修正：

1. **F-02 的根因不是 `run` 返回陈旧输出，而是 `push` 的激活曾经是静默空操作**——该缺陷已在
   `v0.2.7`（commit `fa68edf` / `clients/activation.ts`）修掉。当前构建**无法复现** F-02
   （实测 push V1→run V1、push V2→run V2）。
2. 但 F-02 的"三个信号都说新版、只有 run 是旧的"这一矛盾**仍然真实存在**，只是坏掉的信号不是
   `run` 而是另外两个：**`pull` 返回的是 latest（未激活）源码**，**`inspect --activation` 会在
   存在未激活版本时误报 `ok: true`**。这两条我都在真机上稳定复现了（见 §2.2）。

---

## 1. 总表

图例：✅ 完全证实 ｜ ⚠️ 部分证实 ｜ 🔧 已于 v0.2.7 修复（0.2.6 存在）｜ ❌ 不成立 ｜ 🌐 非 CLI 问题

| ID | 判定 | 核验要点 | 责任层 |
|---|---|---|---|
| F-01 | ✅ 完全证实 | 已发布 `abap-cli@0.2.7` 上端到端复现，报错逐字一致 | 打包 + 错误处理（TS） |
| F-02 | 🔧 + ✅ 残留 | 陈旧输出已修（`fa68edf`）；`pull` 语义 + `inspect --activation` 假阳性仍在 | TS |
| F-03 | ✅ 完全证实 | 零写入本地复现出同一条 `TypeError` | TS |
| F-04 | ✅ 完全证实 | `create` 无存在性检查直接覆盖；三套布局 | TS |
| F-05 | ✅ 完全证实 | 实测：真实第 16 行报成 `line 1` | TS（未回填本地行号） |
| F-06 | ✅ 完全证实 | macOS 必填 `USERNAME`，`--help` 写 Optional，nextSteps 只有 PowerShell | TS |
| F-07 | ⚠️ 部分证实 | `deploy status` 只看版本号是真的；但 skill 文档**已写明**该限制 | TS（help/status） |
| F-08 | ✅ 完全证实 | `ACTIVATION_FAILED` 无 `inspect --activation` 提示，无 written/activated 分离 | TS |
| F-09 | ✅ 完全证实 | `search` 告警 / `select` 硬错误 | TS |
| F-10 | ✅ 完全证实 | 根因在自带 ICF handler 的行类型映射，可修 | ICF ABAP 服务 |
| F-11 | ✅ 完全证实 | 服务端 where 解析器根本没有 `LIKE` 分支，错误文本却列出 LIKE | ICF ABAP 服务 + TS 文案 |
| F-12 | ✅ 完全证实 | 无聚合/GROUP BY，无 `abap count` | TS（能力缺口） |
| F-13 | ⚠️ 部分证实 | 两条 pull 路径确实失败；**"search 看不到视图"不成立** | ICF handler + TS |
| F-14 | ✅ 完全证实 | 客户端 `BUILTIN_DATA_TYPES` 缺 `RAWSTRING` | TS |
| F-15 | ✅ 完全证实 | 文档写了 pull→push 回路，实现是硬编码 stub | 文档 vs ICF ABAP 服务 |
| F-16 | ✅ 完全证实 | `run` 仅支持全局类 | TS（能力缺口） |
| F-17 | ⚠️ 部分证实 | 噪音/无自检是真的；**EPERM 根因是本机执行沙箱**，非 CLI/系统权限 | 环境 + TS（打磨） |
| F-18 | ✅ 完全证实 | 传对象名报"文件名不合法" | TS（错误信息） |
| F-19 | ✅ 完全证实 | 探测失败被表达成 `installed:false` | TS |
| F-20 | ❌ 不成立 | 版本是静态读 package.json，进程内不可能变；是重装/分支切换 | 环境/发布流程 |
| F-21 | ✅ 完全证实 | 仅 5 个模板，无 ALV 骨架 | TS（能力缺口） |
| F-22 | ⚠️ 部分证实 | CLI 无候选/无 list-types 命令是真；但部分"类型错误"在 `check syntax` 下**不可复现** | TS + SAP 内核 |
| F-23 | ⚠️ 部分证实 | CLI 无定向提示；内核行为未复现（503），但有用户侧变通证据 | SAP 内核 + TS |
| F-24 | ⚠️ 部分证实 | 三条 SQL 限制属内核语法；CLI 无定向提示 | SAP 内核 + TS |
| F-25 | ✅ 完全证实 | 无 `fields` 命令；`inspect --structure` 对表返回 0 元素 | TS（能力缺口） |
| F-26 | ✅ 完全证实 | 根因在 ICF handler：INT/RAW 被映射成 CHAR | ICF ABAP 服务 |
| F-27 | ✅ 完全证实 | 客户端缺 `RAWSTRING` 解析，无降级 | TS |
| F-28 | ⚠️ 部分证实 | 两条 pull 路径失败是真；`search --exact` 失败是**通用 bug**，且 `search TRDIR` 能找到 | ICF handler + TS |
| F-29 | ✅ 完全证实 | 无 HTML 归类，整页 HTML 直接进 `error.message`（我用 503 复现了同一机制） | TS |
| F-30 | 🌐 非 CLI 问题 | 纯 SAP 内核类型解析；次要缺口是 check 不透出候选 | SAP 内核 |

---

## 2. 关键发现详解

### 2.1 F-01 — 完全证实，且**已发布版本上可 100% 复现**

这是本次核验里证据最硬的一条。我直接从 npm 安装了已发布包并运行：

```bash
npm install abap-cli@0.2.7 --prefix /tmp   # 实测：安装了 90 个包，其中没有 ajv
node /tmp/node_modules/abap-cli/dist/src/abap_cli/index.js create --help   # → exit 1
node /tmp/node_modules/abap-cli/dist/src/abap_cli/index.js validate:aff --help
```

输出与反馈**逐字一致**（含 `top-error.js:150:41`、`index.js:291:5`）：

```
Error: Cannot find package 'ajv' imported from .../dist/src/abap_cli/aff/schema-validator.js
<anonymous_script>:1
Error: Cannot find package 'ajv' imported from .../dist/src/abap_cli/aff/schema-validator.js
^
SyntaxError: Unexpected token 'E', "Error: Can"... is not valid JSON
    at JSON.parse (<anonymous>)
    at handleTopLevelError (file:///.../dist/src/abap_cli/top-error.js:150:41)
```

**机制（对反馈文档的一处必要修正）**：`ajv` / `ajv-formats` 并不在 `dependencies`，而在
`devDependencies`（`package.json:66-67`；发布元数据 `npm view abap-cli@0.2.7 devDependencies`
同样如此），且 `schema-validator.ts:20-21` 对它们是**静态 ESM import**，`files: ["dist", ...]`
又不携带 `node_modules`。所以根因不是"声明的运行时依赖丢了"，而是
**发布产物静态 import 了一个 devDependency**。`npm i -g` 只装 dependencies ⇒ 必然缺 ajv。

**二次崩溃**同样是真缺陷，且在当前源码中**未修**：`top-error.ts:175`（构建后 `top-error.js:150`）

```ts
error: out.stderr[0] ? JSON.parse(out.stderr[0])?.error ?? {} : {},
```

人类可读模式下 `renderError` 产出的是 `Error: <msg>` 纯文本（`output/json.ts:175`），`JSON.parse`
直接抛 `SyntaxError`，把真实原因覆盖掉。`registry` 在 `index.ts:220-221/306` 恒为真，所以任何逃逸到
`handleTopLevelError` 的非 Commander 错误都会踩到。

**补充证实**：`abap doctor` 的 `env.deps` 只探测 OS keychain（`flows/setup/doctor-checks.ts:136-162`），
完全没覆盖 ajv——反馈第 3 条建议成立。

**当前本机为什么没崩**：`/opt/homebrew/lib/node_modules/abap-cli` 是指向本仓库的 **symlink**，
于是复用了仓库里装了 devDependencies 的 `node_modules`。这掩盖了缺陷，不能作为"已修"的证据。

---

### 2.2 F-02 — 陈旧输出已修，但两个"撒谎的信号"仍在 ★ 本次最重要的发现

#### (a) 原症状的根因已定位并已修复（v0.2.7，0.2.6 无）

`CHANGELOG.md:45` 与 commit `fa68edf`（`fix(activate): stop activation from silently no-opping on
on-prem SAP`）明确记录：

> `abap-adt-api` 的 `activate()` 数组重载在 object reference 上带 `adtcore:type` + `adtcore:parentUri`，
> 本机 on-prem SAP 对此返回 HTTP 200 与 `<chkl:properties checkExecuted="false"
> activationExecuted="false" generationExecuted="false"/>`——**不检查、不激活、不生成，也不报错**。
> ……新增 `clients/activation.ts` 自己构造请求体……同时解析激活响应，把 SAP 在激活阶段报出的语法错误
> （含行号）抛成 `ACTIVATION_FAILED`，不再吞掉。经真机验证：新建类 push 后 `abap run` 能立即执行到新源码。

`clients/activation.ts` 在 tag `v0.2.6` **不存在**、在 `v0.2.7` 与 HEAD **存在**。反馈自己记录的版本轨迹
（会话开始 0.2.7 → 中途重装变 0.2.6）正好解释了 F-02 为什么在那一刻出现。

**我的实测（新建 $TMP 一次性类 `ZCL_ZZ_F02CHECK`，已删除）**：

| 步骤 | 结果 |
|---|---|
| `abap create` → `push` V1（`MARKER_V1`） | `"status":"activated"` |
| `abap run` | `MARKER_V1` ✅ |
| 改成 V2 后 `push` | `"status":"activated"` |
| `abap run` | `MARKER_V2` ✅ **不陈旧** |

结论：**F-02 描述的"run 返回上一版输出"在当前构建不可复现**；它是 `push` 静默空激活的连带症状，
反馈把它归因为"classrun 服务端缓存 / run 取错版本"是**误诊**。

#### (b) 但反馈的另一半怀疑是对的，而且比他说的更严重

反馈特意加了一句提醒（原文档 line 128）：

> ⚠️ 无法排除 `pull` 取回的是 **latest**（含未激活）版本而不是 **active** 版本。

**这条被证实了**。`pull` / `status` / `diff` 都走 `client.getObjectSource(url)`（无 `version` 参数，
见 `clients/adt-client.ts:253-255`），而 `inspect --activation` 自己用的是
`getActiveObjectSource`（`version:'active'`，`:257-260`）——即作者本人就认为默认取回的是最新版。

我构造了一个真实的"半写"状态（故意让激活失败的源码留在 SAP 上）：

| 观测 | 结果 | 含义 |
|---|---|---|
| 本地真实错误位置 | 第 **16** 行 `lv_x = .` | — |
| `abap push` 报错 | `line 1: Error in assignment: Expression missing.` | **行号错乱（F-05 复现）** |
| `abap run` | `MARKER_V2`（旧 active 版） | run 执行 active，行为正确 |
| `abap pull` | **`MARKER_BROKEN`**（未激活的新版） | **pull 返回 latest，不是 active** |
| `abap inspect --activation` | **`ok: true`，`inactive: null`** | **假阳性！** |

`inspect --activation` 的 `parts` 里只有 `main` 是 `active:false`：

```
definitions True | implementations True | macros True | testclasses True | main False
```

而代码**故意把 `main` 排除在 `ok` 之外**（`flows/search/inspect-ops.ts:196-215`，注释称
"The class activation state is determined by the implementation parts above, not by this flag"）。
可是对 OO 类而言，**未激活的新源码恰恰只体现在 `source/main`**；`includes/*` 返回的是旧内容，
两边相等 ⇒ 逐 part 比较全为 true ⇒ 整体误报 `ok: true`。

**这就完整解释了反馈的 F-02 现场**：`push`（旧版）报成功 + `inspect --activation` 报 ok + `pull` 给出新源码，
三个信号里**两个是假的**，而 `run` 一直是对的。反馈"`run` 不可信"的结论应当改写为
"**`pull` 与 `inspect --activation` 不可信**"。

#### (c) 顺带核验 F-05 / F-08（同一次实验）

- **F-05 ✅**：真实第 16 行 → 报 `line 1`。CLI 把 SAP 的 `@_line` 原样透传
  （`clients/activation.ts:114-123`、`:150-162`），既没回填本地文件行号，也没有 `nextSteps`。
  附带发现：消息前缀重复了两次——`Activation failed for ZCL_ZZ_F02CHECK: Activation failed for
  ZCL_ZZ_F02CHECK: line 1: ...`（`throwOnActivationFailure` 与 `push-object.ts:170-174` 各拼了一次）。
- **F-08 ✅**：`ACTIVATION_FAILED` 的 `nextSteps` 只有
  `["Inspect the failing file's `code` and `stage` fields.", "Fix the issue and re-run with --keep-going..."]`，
  确实没有提示对象已写入未激活；`push --json` 的 `results[]` 也只有单一 `status:"failed"`，
  无 `written` / `activated` 两个状态位。

---

### 2.3 F-03 — 完全证实（零写入复现）

`flows/edit/create.ts:91` 允许 `--file` 顶替 `--description`，`:174` 仍把 `opts.description`（undefined）
传下去；`clients/create-object.ts:107-113` 的 `encodeAttr` 直接 `s.replace(...)`。我用本地桩复现（**未碰 SAP**）：

```
THREW: TypeError | Cannot read properties of undefined (reading 'replace')
```

与反馈的原文字节一致。注意 DDIC 类走的是另一条路（`create-ddic.ts:93` 会从 AFF 里取 description），
**只有 CLAS/INTF/PROG/FUGR 这条 ADT 路径有这个洞**——反馈用的正是 `create PROG --file`。

---

### 2.4 关于 `create` 的额外发现（反馈未记录）

核验 F-02 时，第一次 `abap create CLAS` 返回了 **500 ICM HTML 错误页**，但对象**实际已经建出来了**：

```
Error: Failed to create CLAS ZCL_ZZ_F02CHECK: 500 Internal Server Error<br>
...
# 紧接着第二次执行同一命令：
{"code":"OBJECT_EXISTS","message":"Object ZCL_ZZ_F02CHECK already exists"}
```

即 `create` 也会留下"报失败但对象已存在"的半写状态，且错误信息是整页 HTML——与 F-29 同一类问题，
但发生在 `create` 而不是 `run`。

---

### 2.5 环境层的两条归位（会改变优先级判断）

1. **F-17 的 `EPERM` 根因是本机执行沙箱，不是 CLI 也不是 macOS 权限**。
   `~/.abap-cli/sessions/` 目录属主是 `lei`、权限 `drwxr-xr-x`、jar 文件可读且确有历史写入，
   但 `touch ~/.abap-cli/sessions/x` 直接 `Operation not permitted` —— 这是当前 agent harness 的
   workspace-write 文件沙箱在拒绝工作区外的写入。
   **仍然成立的 CLI 缺陷**：`session/reuse.ts:68-77` 每次失败都告警、没有一次性自检/降级
   （对照：keychain 分支 `session/key.ts:82,98-104` 就做了 one-shot 守卫）。
   **真实影响**：会话 jar 无法持久化 ⇒ 复用失效 ⇒ 每次全新登录；子代理实测由此累积到
   **所有 ADT 端点返回 503**。

2. **ICF 通道的 `400 Session Timed Out` 不会触发重登**。`clients/icf-client.ts:181-196` 的
   stale-session 兜底只处理 401/403。于是过期的 cookie jar 会让**所有 ICF 命令**（`select`、
   `deploy status`、`--textpool`、TABL pull）持续失败，直到手动 `ABAP_CLI_SESSION_POLICY=always-logout`。
   这条反馈里没有，但它是 F-19 现场"`deploy status` 说 unreachable 而 ADT 可用"的一个直接成因。

3. **F-19 在本次也被独立复现**：`deploy status` 报
   `installed:false, status:"unreachable", runtime:"unknown"` + `ICF_CHECK_DEGRADED: ICF request
   failed: 400 Session Timed Out`，而同一时刻 `search` 正常、`select` 确实打到了已部署的 ICF handler
   （返回应用级 400，而不是 404）。根因是 `commands/deploy.ts:112` 把任何探测失败都算作未安装。

---

### 2.6 F-28 / F-13 的一处纠正

反馈说 `search --exact TRDIR` 找不到 ⇒ "视图有发现盲区"。核验结果：

- `search TRDIR --exact` 失败是**通用 bug**，与视图无关：
  `commands/search.ts:93` 把 `--exact` 放宽成 `*TRDIR*`，却只按 `--limit`（默认 20）取一页再在客户端做精确过滤
  （`:175-187`）。**`search TADIR --exact` 同样返回空**，而 `search TADIR` 能找到。
- `abap search TRDIR`、`abap search TRDIR --exact --type VIEW` 都能找到 `TRDIR (VIEW/DV)`。
- `select --table TRDIR --fields "NAME,UNAM,UDAT" --limit 3` 也能正常读出 3 行。

所以"视图对 search 不可见"**不成立**；成立的是"`pull` 的两条路径都拿不到视图"（ICF handler 拒绝
`tabclass <> 'TRANSP'`，且 `VIEW` 不在客户端类型注册表里）。

---

### 2.7 F-22 的一处纠正

反馈把一批 `check syntax` 的 "unknown / Unable to interpret" 归为同一类。核验时实测：

- `TYPE char4` / `TYPE char40` / `DATA r TYPE RANGE OF trobjtype.` / `DATA r TYPE RANGE OF char4.` /
  裸 `TYPE-POOLS abap_lvc.` 在**当前构建 + 当前系统**上 `check syntax` 全部返回 **OK**。

也就是说反馈表格里 `Unable to interpret "TROBJTYPE"` / `"CHAR4"` 这些文本，更可能来自**激活/生成阶段**
（与 F-05 同源，是 `ACTIVATION_FAILED`/generator 的诊断），而不是 `check syntax`。这恰好呼应反馈自己
在 §6 写下的矛盾（`check syntax` 全 `failure:false`，`push` 却激活失败）。
`char60` / `rgsb4` / `rsdsfragtab` / `SLIS_LVC_LAYOUT` / 方法参数 `TYPE c LENGTH 60` 因系统 503 未能复现。

**但 F-22 的 CLI 侧主张仍然成立**：`check.ts:310-332` 原样透传服务端文本，`output/issues.ts` 的
`CheckIssue` **没有**放候选/提示的字段，也没有任何"列出类型/类型池"的只读命令。

---

## 3. 反馈文档中需要修正的表述

| 原文 | 问题 | 建议改写 |
|---|---|---|
| §0/F-20"版本从 0.2.7 变 0.2.6" 暗示 CLI 版本漂移 | 版本静态读 `package.json`（`index.ts:163`、`meta.ts:137-146`），进程内不可能变；是重装/分支切换 | 改为"发布/安装身份不清晰"：dev 分支 `package.json` 仍是 `0.2.6`，而 tag `v0.2.7` 已发布且在 `main` 上、**不是 dev 的祖先**，所以 `--version` 无法区分代码版本 |
| F-02"run 返回陈旧版本输出 / classrun 可能服务端缓存" | 误诊；`run` 一直正确 | 改为"`pull` 返回 latest、`inspect --activation` 误报 ok，导致无法判断 run 执行的是哪一版" |
| F-02 证据 B"激活状态正常" | 该信号本身不可信 | `inspect --activation` 在 OO 类上只看 `includes/*`，会漏掉 `source/main` 里的未激活版本 |
| F-01"package.json 声明了 ajv，但全局安装下没有" | ajv 在 **devDependencies**，不是 dependencies | 改为"发布产物 `dist` 静态 import 了 devDependency" |
| F-07"skill 文档也说明 --method 可用" | skill 文档**已明确写出** `WRAPPER_INPUT_UNAVAILABLE` 与改用直接 classrun | 把范围缩小到 `abap run --help` 与 `deploy status` |
| F-13 / F-28"search 也看不到视图" | `search TRDIR` 能找到；`--exact` 是通用 bug | 拆成两条：pull 取不到视图（真）+ `--exact` 分页 bug（通用） |
| F-17 暗示 CLI/系统权限问题 | 本机是 harness 沙箱拒绝工作区外写入 | 保留"告警噪音 + 缺自检"的 CLI 建议，去掉权限归因 |
| F-22 把 `check syntax` 与激活诊断混为一谈 | `RANGE OF trobjtype` 等在 check 下可复现为 OK | 标注这些文本来自激活/生成阶段 |

---

## 4. 建议的修复优先级（按"真实且影响大"排序）

1. **F-01 / 打包（P0）**：把 `ajv`、`ajv-formats` 移入 `dependencies`，或改成惰性 `import()`；
   并把 `top-error.ts:175` 的 `JSON.parse` 加 try/catch 降级为"打印原文 + 退出码"。
   这一条已发布版本 100% 崩溃，且会连带 `create`/`pull`/`push`/`validate:aff` 的 `--help`。
2. **`inspect --activation` 假阳性（P0，新发现）**：OO 类必须比较 `source/main` 的
   latest vs active（或直接读 `ioc:inactiveObjects` / 编辑会话状态），不能只看 `includes/*`。
3. **`pull` 的版本语义（P0/P1，新发现）**：`pull --json` / `diff` 输出标注
   `versionKind: "latest" | "active"`，或提供 `--active`；否则"取回的源码"与"run 执行的行为"会永久脱节。
4. **F-03（P1）**：`--file` 路径下从 AFF `header.description` 取值；`encodeAttr` 加 `String(s ?? '')`。
5. **F-05 / F-08（P1）**：激活失败时回填本地文件行号，`nextSteps` 加 `inspect --activation`，
   `results[]` 区分 `written` / `activated`；顺手修掉重复的消息前缀。
6. **F-25 / F-26（P1）**：新增 `abap fields <table>`（服务端读 `DD03L` + `DD04T`）；
   同时修 ICF handler 里 INT/RAW→CHAR 的行类型映射（这是 F-10 / F-26 的共同根因）。
7. **ICF 会话兜底（P1，新发现）**：`icf-client.ts:181-196` 对 `400 Session Timed Out` 也重新登录一次。
8. **F-27 / F-14（P2）**：客户端 `BUILTIN_DATA_TYPES` 补 `RAWSTRING`（以及 `LRAW`/`LCHR`/`STRING`/`DF16_DEC`），
   或在解析失败时降级为 DD03L 字段清单。
9. **F-15（P2，文档）**：`skills/abap-cli-edit/references/workflow.md:188-204` 的"变体 8"与
   `docs/getting-started.md:150` 明写 textpool "read/write"，需按系统能力加限制说明。
10. **F-19 / F-18 / F-09（P2）**：信号与文案一致性问题，成本低。

---

## 5. 核验方法与可重复性

- **代码层**：逐条 `grep` + 阅读 `src/`，并对关键路径构造**零副作用**的本地复现
  （F-03 直接调用 `createObjectXml` 并传入会抛错的桩 http）。
- **打包层**：`npm install abap-cli@0.2.7 --prefix /tmp` + `npm view abap-cli@0.2.7 devDependencies`，
  端到端复现 F-01。另在 `/tmp/abapcli-sim` 构造"无 ajv 的模拟安装"验证影响面
  （`create --help` / `create local --help` / `pull --help` / `push --help` / `validate:aff --help` 全部崩溃）。
- **真机层（A4H，profile `real`）**：全部只读命令 + 一次**经用户批准**的受控写实验：
  新建一次性类 `ZCL_ZZ_F02CHECK`（`$TMP`）→ 改源码 → push → run → 构造激活失败 → pull/inspect 对比
  → 恢复 → **用 ADT lock+delete 删除该测试类并验证 `OBJECT_NOT_FOUND`**。系统已恢复原状。
- **证据留存**：子代理的详细报告在 `tmp/verify-p2/report-F09-F16.md`、`tmp/verify-p3/REPORT-p3.md`、
  `tmp/verify-p4/FINDINGS-F25-F30.md`（`tmp/` 已在 `.gitignore` 中）。
- **环境限制**：A4H 在后半程持续返回 503（`deploy status` 也观测到 `503 Service Not Available`
  的整页 ICM HTML），部分条目（F-22 的若干类型、F-24、F-30）因此只能给代码层证据，已逐条标注"未能运行时复现"。
