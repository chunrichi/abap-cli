# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组；breaking 变更在 `Removed` 标记并附 **Migration**。
条目面向 CLI 用户：写「用户能做什么 / 行为如何变化 / 升级要注意什么」，不写内部实现（类名、ABAP 函数、文件路径、错误码枚举）；同一功能的细节合并成一条。

## [Unreleased]

### Added

- **`UCON_HTTP`（UCON HTTP service）**：新增 UCON HTTP service 类型，支持 `create` / `pull` / `push` / `delete`，本地文件为 `<name>.ucon_http.json`。文档建模按顺序排列的 handler 类列表（至少一个，类必须存在，服务序号唯一且可省略）、可选的短文本和可选的 SICF 节点关联；`pull` 会把已有服务的 handler 列表、描述和 ICF 节点关联一并带回，`push` 原样写回。服务是 TADIR 对象：`--package` / `--tr` 适用，`$` 开头的本地包免传输；写入即激活并保存（没有单独的 `--no-activate` 步骤）。短文本按会话语言读写（其它语言行不被修改）；UCON profile、运行时缓存维护和 handler 逻辑仍在 UCONCOCKPIT 完成。本类型依赖内置 ICF 服务 2.7.0，升级后执行一次 `abap deploy --yes`。

### Fixed

- **Windows 上读取已存密码失败**：在 Windows 上，凡是用到已保存密码的命令（`abap init`、`abap profile test` 等）都会在读取凭据管理器的环节直接失败，只能用 `--password` 重新输入密码。现在可以正常读出已存密码并继续连接；密码里的非 ASCII 字符和首尾空格也会原样保留。
- **JOBD 不再阻塞内置 ICF 服务部署**：在没有应用作业存储（老 ECC 或未安装 STJR 作业库的 release）的系统上，`abap deploy` 以前会把整个内置 ICF 服务判为激活失败，导致所有依赖 ICF 的命令一起不可用；现在 JOBD 的 SAP 侧类型与表访问都按目标系统的运行时能力解析，缺少作业库时服务照常部署，只有 `/jobd` 明确返回不支持（exit 7）。升级后执行一次 `abap deploy --yes` 即可，已有对象无需迁移。
- **退出登录不再依赖 ICF logoff**：部分系统禁用了 `/sap/public/bc/icf/logoff`（返回 403），以前 CLI 会把这个失败静默忽略，命令结束时可能把 SAP 会话留在 SM04；会话越积越多后新请求会报 `400 Session not found`。现在优先通过 ADT 的会话关闭请求终止上下文，NW 7.50 回退到 stateless discovery，最后才回退旧 logoff；清理失败会在 stderr 明确告警，不再静默。这是 CLI 侧修复，不需要重新部署 ICF 服务。

## [2.6.1] - 2026-11-05

本版修复 TABL / STRU 建表对数值与深类型字段的支持：含 `abap.int4` / `abap.dec` / `abap.string` 等字段的表此前会被 SAP 拒绝（增强类别不匹配、深类型名不存在），现在按 DDL 的 `@AbapCatalog.enhancement.category` 提交增强类别、缺省时按字段类型推导，`abap pull` 出来的表改完字段 `abap push` 会保留 SAP 侧原有类别。没有破坏性变更；内置 ICF 服务版本随本版到 2.6.1，升级后执行一次 `abap deploy --yes`。

### Fixed

- **TABL / STRU 创建支持数值与深类型字段**：以前 `abap create TABL` 一律按「Can Be Enhanced (Char. Type)」提交，含 `abap.int4` / `abap.dec` / `abap.fltp` 等数值字段或 `abap.string` / `abap.rawstring` 等深字段的表会被 SAP 拒绝（exit 6）；深字段还会报「Data type STRI is not supported」。现在创建按 DDL 的 `@AbapCatalog.enhancement.category` 提交增强类别（DDL 没写时按字段类型推导），`abap.string` / `abap.rawstring` 也能正确建表；`abap pull` 出的表改完字段 `abap push` 会保留 SAP 侧原有增强类别，不再需要手改 DDL；旧版 CLI 配新版 ICF 也能创建这两类表。

## [2.6.0] - 2026-11-04

本版把对象类型扩到 51 类（新增 15 个类型码），新增 `abap whoami`，并把内置 ICF 服务版本线与 CLI 统一到 2.6.0。新增的类型覆盖 basis 配置的几个主要族：SM59 HTTP 目的地、UCON RFC service（`SRFC`）、OAuth 2.0 client profile（`OA2P`）、SM36 应用作业定义（`JOBD`）、授权对象族（`AUTH` / `SUSC` / `SUCU` / `SUSH` / `SUSO`，对应 SU20 / SU21 / SU22 的授权字段、授权对象类、授权组、授权缺省值分配和授权对象），以及 6 类官方 AFF 对象（应用日志对象、更改文档对象、事件绑定、业务配置维护对象，以及 BAdI 实现 / BAdI 增强点）。`abap whoami` 的登录身份由 SAP 系统返回，而不是读取本地 profile 配置，因此切换 profile、CI 注入配置或将来接入 SSO 等认证方式时依然准确。

授权对象族、SM59、SRFC、OA2P、JOBD、`abap whoami` 与 BAdI 实现 / 增强点的读取依赖内置 ICF 服务，服务版本随本版升级到 2.6.0：升级后在每个系统执行一次 `abap deploy --yes` 才能使用这些能力，部署前 `abap deploy status` 会显示 outdated（`abap types` 现列出 51 类）。

### Added

- **`abap whoami`**：由 SAP 系统返回当前连接的实际身份——登录用户、系统 ID / 客户端，以及应用服务器 / 数据库 / OS / ABAP release；输出同时带上工作区 profile 与 endpoint。身份取自 SAP 会话而不是本地 profile 配置，因此在切换 profile、CI 注入配置或将来接入 SSO 等认证方式时都能反映真实登录身份。命令需要已部署新版内置 ICF 服务：服务未安装或版本过旧时会提示先执行 `abap deploy --yes`；`abap whoami --schema --json` 不连 SAP。
- **`SM59`（SM59 HTTP destination）**：新增 `SM59` 类型，管理 SM59 中「HTTP 连接到外部服务器」的目的地，支持 `create` / `pull` / `push` / `delete`。本地文件 `<name>.sm59.json` 可编辑描述、目标主机、端口、协议（HTTP/HTTPS）与路径前缀，`pull` 也能读取系统里已有的 HTTP destination 作为起点。SM59 目的地是客户端无关的系统级配置：没有 package，也不能记录 transport，因此这些命令不接受 `--package` / `--tr`（传了会明确报错，而不是静默忽略）；`create` 不需要 package，创建后所有 client 都能看到该目的地。注意 `push` 是整份目的地定义的覆盖写，而当前只建模了上述常用字段：SSL 证书、代理、登录过程等高级选项不会随文件往返，写入后按 SAP 默认值生效；`pull` 读取已有目的地后 `push` 也会覆盖这些高级设置，请在用途明确的测试目的地或新建目的地上使用。其它 SM59 类型（RFC destination 等）与 UCON HTTP service 不在本版范围内；UCON RFC service（`SRFC`）与 OAuth2 profile（`OA2P`）作为独立类型提供（见下）。
- **`SRFC`（UCON RFC service）**：新增 `SRFC` 类型，管理 Unified Connectivity 中「RFC service」条目，支持 `create` / `pull` / `push` / `delete`。本地文件 `<name>.srfc.json` 建模 function module、scope（`E` / `O` / `P` / `S`，可省略）、默认 UCON profile 与短文本；`create` 要求 function module 存在且 RFC-enabled，`defaultProfile` 必须是系统中已配置的 UCON profile。RFC service 是 TADIR 对象：`--package` / `--tr` 适用，本地 `$` 开头包不需传输请求；写入后刷新 UCON RFC 运行时缓存，使服务无需重启立即生效。注意：短文本按会话语言读写（其它语言行不被修改）；创建时留空 description 会生成与 UCONCOCKPIT 相同的默认文本；communication assembly / RFC profile 的维护不在本类型范围。`create` / `push` 会校验 SAP 侧字段（FM 是否存在 / RFC-enabled、profile 是否存在），错误直接返回而不是静默跳过。
- **`OA2P`（OAuth 2.0 client profile）**：新增 `OA2P` 类型，管理 OAuth 2.0 client profile，支持 `create` / `pull` / `push` / `delete`。本地文件 `<name>.oa2p.json` 建模 service provider type（必须已在 `OA2C_TYPES` 配置）、scopes 列表与 `noAuthCheck` 标志；profile 是 TADIR 对象，`--package` / `--tr` 适用。删除前会检查 profile 是否仍被 OAuth 2.0 client 使用（被使用时拒绝并提示先在 OA2C_CONFIG 解除分配）。注意：profile 没有描述字段（`--description` 不适用）；provider 专属配置对象是无状态的，不在文件里往返；OAuth 2.0 client 与 profile 的分配关系仍在 OA2C_CONFIG 维护。
- **JOBD（应用作业定义，SM36）**：新增应用作业定义类型，支持 `create` / `pull` / `push` / `delete`。本地文件 `<name>.jobd.json` 是本地扩展格式（`jobd-v1`：要执行的报表 / 变式与时间或事件调度参数）；对象经内置 ICF 服务读写，需要先执行一次 `abap deploy --yes`。写入即保存并激活，`--no-activate` 会被拒绝；可传输包需要 `--tr`，`$` 开头的本地包免传输。名称上限 32 字符；报表 / 变式引用由 SAP 在调度时校验，CLI 不做本地校验。删除可传输对象后，传输请求中仍会保留该对象原来的插入条目，发布前需在 SE01/SE03 移除（本地包不受影响）。
- **授权对象族（`AUTH` / `SUSC` / `SUCU` / `SUSH` / `SUSO`）**：新增 5 个授权相关对象类型，均支持 `create` / `pull` / `push` / `delete`，本地各是一个 JSON 文档，写入经内置 ICF 服务完成（需要 `abap deploy --yes` 一次）。`AUTH` 是 SU20 授权字段，`SUSC` 是 SU21 授权对象类，`SUCU` 是授权组，`SUSH` 是 SU22 授权缺省值分配，`SUSO` 是 SU21 授权对象。`pull` 写出 `<token>.<type>.json`，`push` 只更新已存在的对象（创建走 `create`）；写入没有单独的激活步骤，因此 `--no-activate` 与 `--description` 会被拒绝，描述写在文档里。文档沿用 abap-file-format 的 `formatVersion` / `header` 约定：`SUSH` 复用上游官方 `sush-v1` 格式，其余四类使用本地扩展 schema（`AUTH` 在上游基础上补齐 SU20 的两个字段，`SUSC` / `SUCU` / `SUSO` 上游没有可往返的格式）。名称与文件名按 SAP 键设计：`AUTH` ≤30 字符、命名空间用 `(ns)name`；`SUSC` 是 4 字符类名（含 `/XXX`）；`SUCU` 是 40 字符 TADIR 复合键，命令行用 `<GROUP>~<OBJECT>` 简写（如 `CMMFDOR~S_TABU_DIS`，也可直接传 40 字符原始名），文件名为 `<group>~<object>.sucu.json`；`SUSH` 是 `<NAME>.<TYPE>`（`TR` / `RF` / `HT` / `HS` 均可 pull，文件名 `<name>_<type>.sush.json`）；`SUSO` ≤10 字符、命名空间用 `(ns)name`。`$` 前缀本地包写入与删除免 transport，其余包必须显式 `--tr`。
- **SUSH 创建限定为 RFC 函数模块应用**：SU22 的 `TR` / `HT` / `HS` 键由 SAP 根据前导事务 / 对象 / 外部服务计算，CLI 无法在创建前命名，因此 `create` 只接受 `RF`（`applicationType: FUNC`）应用；传入其他键会得到可操作的错误并提示先维护前导对象再 `pull`。已存在的四类键仍可 `pull` / `push` / `delete`。
- **AFF basis 对象（第一批，可读写）**：新增 `APLO`（应用日志对象）、`CHDO`（更改文档对象）、`EVTB`（事件绑定）、`SMBC`（业务配置维护对象）四类对象，支持 `create` / `pull` / `push` / `delete`。本地文件就是官方 abap-file-format JSON（`<name>.<type>.json`，命名空间写作 `(ns)name`），文件名与对象名一致，`pull` 出来可直接改完 `push`；新建需要 `--file` 指定 JSON 文档，`$` 前缀本地包无需 transport，可传输包必须显式 `--tr`。`APLO` 保存即激活；`CHDO` / `EVTB` / `SMBC` 保存后需要激活，CLI 会在写入后自动激活并把 SAP 的校验错误原样返回（例如事件绑定引用的 BO 事件已被占用、业务配置对象引用的服务绑定不存在）。`CHDO` 的对象名沿用 SAP 的 16 字符限制、`APLO` 为 20 字符（超长名在 `create` 时本地先拒绝）。`SMBC` 的写入依赖目标系统已有可用的服务绑定。
- **AFF basis 对象（第二批，只读接入）**：新增 `ENHO`（BAdI 实现）与 `ENHS`（BAdI 增强点）两类对象，支持 `pull`，本地文件为官方 AFF JSON（`<name>.enho.json` / `<name>.enhs.json`）。SAP 参考版本对这两类只提供读取、没有可用的写入接口，因此本版不提供 `create` / `push` / `delete`；命令会给出明确说明，后续版本补写入适配。读取通过内置 ICF 服务的通用 AFF 端点完成，使用前需要执行一次 `abap deploy --yes`。

### Security

- **SUSO 权限配置重生成默认关闭**：`SUSO` 的 `create` / `push` / `delete` 只有显式传入 `--regenerate-profiles` 才会重建 SAP_ALL / SAP_NEW 权限数据，默认完全跳过，避免隐式改写系统权限；是否执行通过 `--json` 的 `data.profilesRegenerated`（push 时为对应文件条目的 `profilesRegenerated`）返回，其他类型传该参数会被拒绝。
- **被引用 / 受保护的授权对象拒绝删除**：删除 `AUTH` / `SUSC` / `SUSO` 前执行 SAP 侧的 where-used 与交付对象校验（被角色、权限对象、事务等引用，或对象受传输管理），拒绝时不产生任何数据变更，并给出下一步操作；可传输包的 `SUCU` 授权组删除请在 SU21 / SM30 完成，以便删除动作进入请求。
- **写入沿用 SAP 的权限与 transport 校验**：内置服务以登录用户的授权执行，`S_DEVELOP` / `S_CTRX` 等检查保留；非 `$` 前缀包的写入与删除必须提供 `--tr`，否则在本地即被拒绝。

## [2.2.0] - 2026-11-03

本版把对象面扩到 ATC 检查配置、CDS 技术对象、CDS 简单类型、类型池和应用作业目录（新增 11 个类型码，`abap types` 现列出 36 类），新增 `abap publish` / `abap unpublish` 两个服务绑定发布命令，并修正本地包 DDIC 对象 push 的 transport 判定。没有移除命令或参数，但有两处行为收紧需要留意（多余位置参数改为报错、TTYP 不再生成 `.type.abap` 侧车），见 Changed。内置 ICF 服务版本随 CLI 统一到 2.2.0，服务端行为没有变化；`abap deploy status` 会提示 outdated，需要时可执行一次 `abap deploy --yes` 对齐版本号。

### Added

- **`abap publish` / `abap unpublish`**：服务绑定的本地 OData endpoint 发布 / 取消发布命令。服务版本与协议版本从绑定元数据推导，按 V2 / V4 自动选择端点，可重复执行；绑定不存在时报对象未找到，元数据缺版本时报校验错误并提示先 `pull` / `inspect`。
- **TYPE（类型池）**：新增 AFF 官方格式的类型池对象，支持 `create` / `pull` / `push` / `delete`（`.type.json` 元数据 + `.type.abap` 源码，名称上限 5 字符）。`TYPES` 名必须带 `<池名>_` 前缀；`push` 只替换描述、保留 SAP 的 Unicode 检查标记，避免后续激活失败。
- **ATC 检查配置对象**：新增 `CHKC`（检查类别）、`CHKO`（检查）、`CHKV`（检查变体）三类对象，支持 `create` / `pull` / `push` / `delete` 全生命周期。`create` / `push` 写入后自动激活（`--no-activate` 只写不激活）；检查变体的 `selectedChecks` 参数（普通值、结构化值、值列表、range 列表）可无损往返。SAP 侧前置条件按原样返回：`CHKO` 的实现类需注册为活动的 ATC 检查且参数 id 匹配，`CHKV` 的参数需与实现类一致。
- **CDS 技术对象**：新增 `DTDC`（动态缓存）、`DTEB`（CDS 实体缓冲）、`DSFD`（CDS 标量函数定义）、`DSFI`（标量函数实现引用）四类对象，支持 `create` / `pull` / `push` / `delete`。`DTDC` / `DTEB` / `DSFD` 为「AFF 元数据 + `.acds` 源码」两件套，`DSFI` 为单个 AFF JSON；`create` / `push` 写入源码后自动激活并同步描述，round-trip 不丢描述。SAP 侧门禁直接暴露：`DSFD` 需要启用用户参数 `DD_CDS_DSFD`，`DTEB` 要求目标视图实体允许缓冲，`DSFI` 名称需带本 release 的引擎后缀（`_ANA`）且引用的 `DSFD` 已激活。`DRAS`（方面）、`DTIX`（字典调优索引）、`DTSC`（字典调优静态缓存）虽有官方 AFF schema，但参考 S/4HANA release 没有对应的 ADT 读写资源，暂不支持。
- **CDS 简单类型（DRTY）**：新增 `DRTY`，支持 `create` / `pull` / `push` / `delete`（AFF 元数据 + `.drty.acds` 两件套）。SAP 侧写入受用户参数 `CDS_SIMPLE_TYPES` 控制；未启用时直接报错并给出 SU3 启用步骤（该检查在 SAP 侧按会话缓存，启用后需新会话生效）。
- **应用作业（SAJC / SAJT）**：新增应用作业目录条目与模板两类对象，支持 `create` / `pull` / `push` / `delete`（`.sajc.json` / `.sajt.json`，官方 AFF 单 JSON，名称上限 40 字符）。本地文件始终是当前 AFF 模型，CLI 按目标 SAP release 的 JSON 模型在读写时转换：目标系统表达不了的字段按字段名报错、不静默丢弃；目录条目引用的执行类、模板引用的目录条目由 SAP 在保存时校验。SAP 侧写入即保存并激活、没有 inactive 版本，因此 `--no-activate` 会被拒绝，`create --check-only` 只做本地校验。

### Changed

- **TTYP 本地文件收口**：表类型是纯 DDIC 元数据（abapGit 同样只序列化元数据），`pull` 只写 `<name>.ttyp.json`，不再生成只读的 `.type.abap` 伪 DDL 侧车；`.type.abap` 归还给类型池（`TYPE`）。已有的 `.type.abap` 不会被改写或删除，`push` 也不读取它，无需迁移。
- **`abap dumps --json` 增加 `title` / `updated`**：运行时 dump 列表现在返回标题与最后更新时间，便于按时间排序和定位问题；按既有字段读取的消费方不受影响。
- **`chko` 的 `hidden` 与 `checkType` 语义**：`parameters[].hidden` 对应 SAP 侧「参数不可修改」，`checkType` 对应检查是否 remote-enabled；`pull` 回读时按 SAP 实际值投影，未设置的默认值（`hidden: false` / `checkType: local`）可能被省略——两种写法等价。
- **`abap init --agent claude` 不再生成根 `CLAUDE.md`**：Claude Code 直接使用 `.claude/skills/` 与 `.claude/agents/`；已有 `CLAUDE.md` 不会被修改或删除。
- **多余位置参数改为报错**：命令后跟了该命令不接受的位置参数时，现在返回用法错误（退出码 2），不再静默忽略（例如 `abap types CLAS extra`）。**Migration**：删掉多余的位置参数；此前依赖「多余参数被忽略」的脚本需要先修正。

### Fixed

- **本地包 DDIC 更新不再要求 transport**：`abap pull` 写出的 DDIC AFF 三件套（DOMA / DTEL / TABL / STRU）不携带 package，此前在 `$TMP` / `$CRW` 等本地包里“pull → 改字段 → push 已有对象”会被当成可传输对象并报缺少 transport（exit 7）。现在本地文件没写 package 时，push 先读回目标对象的现有 package：本地包走 transport-free 写入，可传输包仍按 `--tr` > 配置 > 用户请求解析；VIEW / SHLP / TRAN 的更新走同一规则。

## [2.1.0] - 2026-11-03

本版完成 R1「闭环与真相」收尾（不新增类型码）：HTTP（SICF 节点）现在支持 CLI 删除，并把 HTTP / TTYP / NROB 的本地元数据与写入边界收紧；TTYP 预定义行类型能完整往返长度与小数；TABL / STRU 外键和 TTYP 内联行结构改为本地显式拒绝，不再静默丢弃。本次包含一项 TTYP 本地写法的迁移，见 Changed 段。内置 ICF 服务有改动（服务版本 2.1.0），升级后请执行一次 `abap deploy --yes`。

### Added

- **BDEF 创建**：`abap create BDEF <name> --file <name>.bdef.json --package <pkg>` 现在可用；命令读取同目录的 `.bdef.abdl` 源码，创建行为定义后写入并激活。源码必须指向已存在的 root entity，或引用可用的 unmanaged 实现类。
- **ENQU / NROB 删除**：`abap delete <name> --type ENQU|NROB` 通过内置 ICF 服务删除 `$TMP` 本地锁对象 / 编号范围对象；可传输对象仍请在 SE11 / SNRO 删除，以便删除被记录到传输请求。
- **SRVB 创建/发布**：`abap create SRVB <name> --file <name>.srvb.json --package <pkg>` 从 AFF 元数据创建并激活服务绑定；加 `--publish` 会在激活后调用 ADT publish job。发布是否成功取决于系统是否允许本地发布或是否需要 transport request（不允许时 SAP 返回明确错误，binding 仍已创建）；push/update 不支持。
- **HTTP（SICF 节点）删除**：`abap delete <name> --type HTTP` 删除 `$` 前缀本地包里的 SICF 节点，节点不存在、根节点、仍有子节点、可传输节点与权限不足分别返回明确错误；可传输节点仍请在事务 SICF 删除，以便删除被记录到传输请求。
- **本地 ENQU / NROB 创建写入本地元数据**：`$` 前缀包里的锁对象 / 编号范围对象创建后即可在 SE11 / where-used 中检索到，删除时不再需要临时补元数据。
- **TTYP 预定义行类型的长度/小数**：以 DDIC 内建类型为行类型的表类型（`table of char10`、`table of dec15(2)`）现在能完整 round-trip——`abap pull` 把长度/小数写进本地 JSON 的可选 `lineType.rowTypeLength` / `lineType.rowTypeDecimals`，`abap create` / `abap push` 按同样的值写回 SAP，`.type.abap` 侧车显示为 `table of char(10)`；没有这两个字段的旧文件仍然合法。

### Fixed

- **BDEF 拉取路径**：`abap pull <name> --type BDEF` 改走 ADT 的 behavior-definition 资源（旧路径在 S/4HANA 上返回 404）；blueSource 的相对 `source/main` URI 现在会正确绝对化。
- **HTTP 拉取结果可直接推送**：`abap pull --type HTTP` 写出的文件是严格 AFF 形态（对象名在文件名里，不在 JSON 里），现在 `push` / `create` 会从文件名或命令参数补上对象名，pull → 修改 → push 不再报缺少 `name`。

### Changed

- **HTTP（SICF）写入仅限本地包**：`create` / `push` 不再接受可传输包（此前会忽略包、静默把节点建到 `$TMP`）；可传输 SICF 节点请在事务 SICF 维护。`--tr` 对 HTTP 写入不再生效。
- **TTYP 预定义行类型使用 DDIC 数据类型名**：本地 `lineType.rowType` 对预定义类型必须是 DDIC 数据类型名（`CHAR`、`NUMC`、`DEC`、`DATS`、`TIMN`、`INT4`、`STRING`…），不再把 `C` / `I` / `P` 这类 ABAP 类型码当作内建类型——旧写法在 SAP 激活时本来也会因「数据类型不存在」失败。**Migration**：把 `lineType.rowType` 换成对应的 DDIC 数据类型名（`C`→`CHAR`、`N`→`NUMC`、`P`→`DEC`、`D`→`DATS`、`T`→`TIMS`、`F`→`FLTP`、`X`→`RAW`、`I`→`INT4`），长度/小数写进新增的 `rowTypeLength` / `rowTypeDecimals`。
- **TTYP 内联行结构的错误提示**：`lineType.rowStructure` 仍不支持，但改为专用错误码（exit 7），消息说明内联行结构需在 SE11 / ADT 维护、CLI 只支持 repository 行类型。
- **TABL / STRU 的外键不再静默丢弃**：本地文档带 `@AbapCatalog.foreignKeys` 或 `with foreign key ... check <table>` 时，`create` / `push` 在本地直接报错（exit 7），提示外键要在 SE11 / ADT 维护或从本地文档移除。此前这些声明被悄悄丢掉、SAP 侧不会有外键，激活也可能失败。没有外键的表 / 结构行为不变。
- **NROB 名称上限 10 字符**：编号范围对象名是 `TNRO-NROBJ` 键（10 字符），更长的名字会被 SAP 静默截断；`abap create NROB` 和 `abap delete <name> --type NROB` 现在都在本地拒绝超长名称（exit 7）。此前 delete 放行到 20 字符、create 完全不检查长度。
- **多余位置参数改为报错**：命令后跟了该命令不接受的位置参数时，现在返回 `USAGE` 错误（退出码 2），不再静默忽略（例如 `abap types CLAS extra`）。**Migration**：删掉多余的位置参数；此前依赖「多余参数被忽略」的脚本需要先修正。

## [2.0.1] - 2026-11-02

本版修正 MSAG / TTYP / DDLS 的 ADT 通道读写，补齐两处机器契约缺口（`validate:aff` 的 NROB/ENQU 校验、`profile test` 的 ADT 能力探测），并让 NROB 创建接受空子类型；没有破坏性变更。

### Added

- **TTYP `keyKind` 字段**：`ttyp-v1.json` 新增可选 `keyKind`（`unique` / `nonUnique`），保留 ADT 主键唯一性；sorted/hashed 表类型的键组件现在能完整 round-trip。

### Fixed

- **TTYP 的 ADT 通道修复**：创建此前用不可路由的 `_action=create` URL 且不带完整 DDIC 文档，S/4 上直接 400；pull 按错误形态解析导致行类型/描述丢失；push 的锁句柄放请求头且缺少激活。现在 create/pull/push 全部按 ADT DDIC 模型工作。
- **DDLS 的 ADT 通道修复**：创建/推送此前用错误的 XML 信封 + 请求头锁句柄，源码没有写入 `source/main`、对象未激活；pull 元数据按错误形态解析（描述为空、`sourceType` 落成 `unknown`）。现在创建/推送按「建头 + 锁定写源码 + 激活」执行，pull 解析真实属性并正确识别 `sourceType`。
- **MSAG 拉取不再写出空消息类**：ADT 通道此前按错误的 XML 形态解析，消息类的描述和消息文本会全部丢失；现在按 SAP 实际返回的 ADT 文档解析，`abap pull <消息类> --type MSAG` 能拿回完整描述与消息。
- **MSAG 推送能真正写回消息文本**：ADT 更新此前把锁句柄放在请求头里，SAP 报 "Parameter lockHandle could not be found"；现在按 ADT 约定放在查询参数里，锁定 → 写入 → 解锁正常完成。
- **MSAG 创建分两步写入**：ADT 创建端点只建头，消息文本需要后续锁定写入；此前创建请求里带的消息被 SAP 静默丢弃，得到空消息类。现在创建后立即写入消息。
- **NROB 创建接受空 `subType`**：AFF schema 要求 `subType` 键存在但允许空字符串（没有子对象的普通编号范围对象）；此前内置 ICF 服务会拒绝空值，现在与 SE11 行为一致。
- **`validate:aff` 支持 NROB / ENQU**：此前这两类 AFF 文件被静默跳过（`files: []`）；现在分别按 `enqu-v1.json` / `nrob-v1.json` 校验。
- **`abap profile test` 的 ADT 能力探测**：4xx 曾被当成端点不存在，导致 `capabilities.{ttyp,msag,ddls}.adt` 全部误报 `absent`；现在 4xx 视为端点存在，仅 5xx / 网络错误视为不存在。

### Changed

- **MSAG / TTYP 双通道兜底更完整**：现代内核上 ADT 端点未注册（SAP 答 "No URI-Mapping defined for URI"）时，`create` / `pull` / `push` 自动切到内置 ICF 服务，`data.channel` 为 `icf`、`data.fallbackReason` 为 `ADT_ENDPOINT_UNAVAILABLE`；ECC 旧内核仍为 `ECC_EHP6_NO_ADT_MESSAGECLASS` / `ECC_EHP6_NO_ADT_TABLETYPE`。MSAG 部分涉及内置 ICF 服务，升级后执行一次 `abap deploy --yes`。
- **`$` 本地包上的误传 `--tr` 一律丢弃**：TTYP / DDLS 的 `create` / `push` 与 MSAG / NROB 保持一致，不再把 transport 带进 ADT 请求。

## [2.0.0] - 2026-11-01

本版收窄本地包定义（只有 `$` 前缀免 transport）、放开内置 ICF 服务的本地包支持，并把运行时基线升级到 Node.js 24 LTS。有破坏性变更（Node.js 22/26 不再支持、`TEST...` 前缀的包不再免 transport），见 Migration。

### Changed

- **本地包一律免 transport**：`$` 前缀的本地包（`$TMP`、`$CRW` 等）中的对象在 `create` / `push` / `delete` / `deploy` 时都不再需要 `--tr`，也不会被自动带上任何 transport 请求；此前只有 `$TMP` 享受该规则。内置 ICF 服务同步放开：ENQU / NROB 创建、XSLT 创建、VIEW / SHLP / TRAN 删除对 `$` 前缀本地包不再要求 transport（ENQU / NROB 的 `push` 走同一 POST，同样受益）；升级后执行一次 `abap deploy`。`TEST...` 等非 `$` 开头的包不视为本地，仍需 `--tr`。本地包上传入的 `--tr` 会被忽略：既不写进请求体，也不出现在 `data.transport`（`abap deploy` 是唯一显式拒绝 `--tr` 的入口）。
- **运行时基线改为 Node.js 24 LTS**：`engines.node` 从 `^22.23.4 || ^24.22.1 || >=26.12.1` 收窄为 `^24.22.1`；`abap doctor` 会对其它版本给出升级提示。

### Removed (breaking)

- **Node.js 22 及更早、26 及更新版本线不再支持**：CLI 只在 Node.js 24 LTS（24.22.1+）上测试和发布。

**Migration**：

- 升级到 Node.js 24 LTS（Homebrew 用户把 `node@22` 换成 `node@24`，或用官方安装包）后重跑 CLI；npm 使用方在 Node 24 下重新安装依赖即可。
- 本地包判定以 `$` 前缀为准：`TEST...` 前缀的包不再免 transport，需要 `--tr`。
- 内置 ICF 服务版本随 CLI 升到 2.0.0：升级后 `abap deploy status` 会提示 outdated，先执行一次 `abap deploy --yes`；旧的「仅 `$TMP` 免 transport」服务端行为在重新部署前保持不变。

## [1.3.0] - 2026-11-01

本版重做 CLI 的 SAP 会话层：跨命令真正复用同一个 SAP 会话，无法复用时命令结束一定登出，`SM04` 不再按命令数增长；会话存储/密钥/复用状态可通过 `abap session info` 直接看到。有破坏性变更（`session info --json` 形状、`$TMPDIR` 兜底移除），见 Migration。

### Added

- **`abap session reset`**：删除当前 profile 的持久化会话（含损坏隔离副本），用于会话复用因连续失败被暂停后立即重试；需 `--yes`。
- **`abap session info` 重建**：报告实际生效的会话存储、所有候选目录、密钥来源、jar 的真实 cookie 数 / CSRF / 连续失败计数，以及复用是否启用及原因。
- **`ABAP_CLI_SESSION_DIR`**：显式指定会话存储目录（agent 沙箱/CI 需要固定位置时使用）。
- **`ABAP_CLI_SESSION_KEY_MODE=derived`**：不依赖 OS keychain 的确定性会话密钥，供无 keychain 的测试/CI 启用会话复用。
- **工作区会话存储**：HOME 不可写（agent sandbox / CI）时自动使用 `<workspace>/.abap-cli/sessions`（目录自忽略、0700/0600、加密），不再依赖 `$TMPDIR`。

### Changed

- **会话复用判定改为「可持久化且未被拒绝」**：只有 jar 写入 durable 会话存储、包含 stateful 会话 cookie、且未被连续拒绝时，命令结束才保留会话；否则本轮登录的会话在命令结束时登出。`$TMPDIR` 兜底被移除——它无法证明下一条命令能读到 jar。
- **内置 ICF 服务改为无状态**：`/sap/abap_cli/` 的请求不再保留 SAP HTTP 会话（此前每条走 ICF 的命令会在 SM04 留下一个会话）。升级后执行一次 `abap deploy --yes`。
- **会话降级可见**：复用不可用、工作区回退、连续被拒、损坏 jar 都会以结构化 warning 出现在 `--json` 的 `meta.warnings`，不再只有一次 stderr 提示。
- **`abap doctor`** 增加 `session.store` / `session.key` 检查（离线）。

### Fixed

- **每条命令在 SM04 残留一个 SAP 会话**：ADT 请求未携带 `sap-contextid` 时，SAP 会把它路由到一个新的用户会话（HTTP 200、无报错），jar 里的登录会话从未被真正复用；现在会话 cookie 与 context cookie 成对持久化/回放，跨命令复用同一个 SAP 会话。
- **「无法复用时命令结束登出」的安全网**此前按「jar 写成功」判定，在退化路径上不触发；现在按实际可复用性判定。
- **`session info` 只看 `~/.abap-cli/sessions`**，fallback/工作区 jar 不可见、`cookieCount=0` 误导；现在报告实际生效的存储与 jar。

### Removed (breaking)

- **`abap session info --json` 的 `data` 形状**：`jarPath` / `lastLoginAt` / `cookieCount` / `csrfPresent` 改为 `store` / `candidates` / `jar` 结构，并新增 `keyMode` / `reuseEnabled` / `reuseReason`；`data.jar` 为 `null` 表示没有可读 jar。
- **`$TMPDIR/abap-cli/sessions` 兜底存储**：不再读写。HOME 不可写时自动落工作区存储；两者都不可写时会话复用关闭（每条命令登录+登出，SM04 不增长）。

**Migration**：

- 消费 `abap session info --json` 的脚本：改读 `data.store` / `data.candidates` / `data.jar`；没有会话时 `data.jar === null`。
- agent / CI 沙箱：通常无需配置（自动使用工作区存储）；如果需要固定位置，设置 `ABAP_CLI_SESSION_DIR`。
- 升级后执行一次 `abap deploy --yes` 应用 ICF 无状态变更（ICF 服务版本随 CLI 升到 1.3.0；`abap deploy status` 会提示 outdated）。

## [1.2.0] - 2026-11-01

本版把「改完能验、能交付、能追溯」补进 agent 闭环，并统一机器可读契约：修复一批"看着成功、实际没生效/没执行"的假成功路径，新增传输预检与释放、版本历史与结构符号读取、`doctor --strict`。有破坏性变更（退出码与 `--json` 形状），见 Migration。

### Added

- **传输预检与释放**：`abap transport check <对象>` 只读报告该变更会记录到哪个请求、是否被阻塞及阻塞消息；`abap transport release <请求>` 释放请求并输出逐对象结果，支持 `--ignore-locks` / `--ignore-atc` / `--dry-run`，非交互环境需 `--yes`。
- **版本历史与结构符号**：`abap inspect <对象> --versions` 列出 ADT 版本历史（`--show <版本>` 取该版源码，`--out` 落盘）；`abap inspect <对象> --symbols` 把类/接口结构摊平成带源码行号的符号表，可用 `--kinds` / `--name-pattern` 过滤。两者都有各自的 `--schema`。
- **`abap doctor --strict`**：配置或环境有问题时以非零退出码结束，可作为 agent/CI 的前置 gate；`doctor` 同时新增 `data.ok`，`--fix` 会输出已修复项与剩余问题。

### Changed

- **`--json` 失败路径统一**：缺参或裸调用一律以用法错误（exit 2）结束，stdout 为空、stderr 只有一个可解析的 JSON 信封；人类 help 只保留在 `--help` / `abap help`（exit 0）。
- **配置错误可直接恢复**：配置错误带上缺失字段、可执行的下一步与示例，agent 不再需要从散文里猜命令。
- **`doctor` 不再"假绿"**：配置全错时 `data.ok=false`；加 `--strict` 后退出码反映问题。
- **`validate:aff` 纳入统一契约**：缺参/路径不存在为用法错误（exit 2），校验失败为校验错误（exit 7）；输出走统一信封、紧凑 JSON，文件路径为 cwd 相对 POSIX。
- **push 的激活校验区分"没有变更"与"静默失败"**：SAP 返回 200 但没执行激活时，先确认是否真的还有未激活版本——有则失败；没有（重复推送未改动的源码）则成功并给出告警。
- **SAP 错误更可诊断**：失败详情包含 SAP 异常类型与属性，并对常见错误给出恢复建议。
- **AFF 伴生文件要求放宽**：类的 include 与表技术设置改为可选，合法对象不再被 `validate:aff` 误判为失败。
- **本地命令标注修正**：`validate:aff`、`report-stuck`、`session` 不再被列为"会连接 SAP"。

### Fixed

- `--json` 下裸调用/缺参输出人类 help 且 exit 0，agent 会误判成功。
- 把对象元数据 `.json` 当 ABAP 源码 push 会写脏 SAP 且可能报成功；现在直接拒绝并提示源文件。
- `doctor` 在配置全错时仍报成功；`validate:aff` 缺文件/无参数仍报成功。
- `transport` / `session` 裸调用时 stdout 与 stderr 双写 help。
- `push` 在 SAP 静默跳过激活时报告成功。
- `inspect --versions` 在类 include 上拿不到版本号；`inspect --symbols` 的成员类型映射不全。

### Removed (breaking)

- **`--json` 下缺参/裸调用的退出码**：`abap pull`、`run`、`check`、`profile`、`tcode`、`mime` 原先 exit 0 且 stdout 是 help；现在 exit 2、stdout 为空、stderr 单个 JSON 信封。
- **`validate:aff` 退出码与 JSON 形状**：校验失败从 exit 1 改为 7，缺参/路径不存在从 exit 0 改为 2；`--json` 从 `{status, summary, files}` 改为统一信封 `{status, meta, data:{summary, files}}`，`files[].path` 由绝对路径改为 cwd 相对路径。
- **profile 名称规则**：名称需 1–64 字符、字母/数字/`_`/`.`/`-` 且以字母或数字开头；旧名仍可读取/连接/删除，但不能 `set` 或导出后重新导入。

**Migration**：

- 脚本依赖"裸调用 exit 0 + help"的，改为传必填参数；需要 help 时用 `--help` 或 `abap help <命令>`。
- 消费 `validate:aff --json` 的脚本：改读 `data.files[]`，按 exit 7（校验失败）/ 2（用法错误）分支。
- 以 `abap doctor` 退出码做 gate 的脚本：改用 `abap doctor --strict`（默认仍 exit 0，保持诊断语义）。
- 旧 profile 名含空格/斜杠等字符时：`abap profile delete <名>` 后以合法名称重新 `abap profile add`；工作区用 `abap init --profile <新名>` 重新绑定。
- 本次内置 ICF 服务版本随 CLI 升到 1.2.0（无端点功能变化）；升级后执行一次 `abap deploy --yes`，让 `deploy status` 恢复匹配。

## [1.1.0] - 2026-10-31

新增 4 类对象（DEVC / VIEW / SHLP / XSLT）、事务码写路径与长文本支持，并修复真实 SAP 上的会话、DDIC、HTTP pull 问题。升级后执行一次 `abap deploy --yes` 刷新内置 ICF 服务。含 breaking 变更，见 Migration。

### Added

- **数据库视图（VIEW）与搜索帮助（SHLP）**：支持 `create` / `pull` / `push` / `delete` 全流程，覆盖 join 视图、elementary 与 collective 搜索帮助；删除仅支持 `$TMP` 对象。已在 S/4HANA 真机验证。
- **XSLT 转换程序**：新增 `XSLT` 对象类型，本地为 `.xslt.json`（元数据）+ `.xslt.xml`（源码）两件套；支持创建、拉取、原地更新（保留版本历史）与删除。
- **事务码（TRAN）写路径**：`create` / `push` / `delete` 现在可用，支持 dialog / report（含 variant）/ parameter / variant 四类事务；OO 事务仍只读（SAP 规范功能不支持）。此前部分类型 `pull` 出来还是空文档，现已修复。
- **DOMA / DTEL 长文本**：`pull` 自动把对象长文本拉到 `<name>.<type>.docu.json` 伴生文件，`push` 自动推送；`lines: []` 删除远端长文本，`abap validate:aff` 识别伴生文件。
- **DEVC 包**：支持 `create`（`--check-only` 可预检）/ `pull` / `delete`；`push` 不支持（ADT 没有包更新接口）。
- **`abap test`**：在真实 SAP 上运行 ABAP Unit，只输出 summary 与失败用例；支持按风险等级、时长、类型过滤与 `--strict`。
- **对象类型扩展到 25 种**：`abap types` 现在列出 25 个类型码（各类型的 create / pull / push 支持情况见 README）。

### Changed

- **ICF 服务版本 1.1.0**：npm 包、CLI `--version` 与内置 ABAP 服务版本统一；升级后执行一次 `abap deploy --yes`，`abap deploy status` 会提示版本是否匹配。
- **本地 AFF 文件与 SAP 官方格式对齐**：HTTP 配置字段、消息类 `number`、表技术设置 `sizeCategory` 等校验与上游一致；少数旧文件可能需要重新 `pull`。

### Fixed

- **真实 SAP 上的会话问题**：CLI 不再保存或回放匿名上下文 cookie，长任务与失败命令也会正确关闭会话。此前会堆积 stateful 会话，最终所有 ADT 命令报 `400 Session not found`；现在会话可稳定复用，SM04 里不再"一条命令一条会话"。
- **DDIC 创建/推送**：真实 SAP 上 `create` / `push` DOMA / DTEL / TABL / STRU 此前会因字段转换、DTEL 嵌套类型与表技术设置失败；现在可直接创建并读回一致。
- **HTTP pull**：真实 SAP 上拉取 SICF 节点此前会产生过不了 `validate:aff` / `push` 的文件（描述超长、SICF 扩展字段）；现在拉下来的文件可直接校验与推送，旧文件重新 `pull` 即可。
- **`create local`**：CDS / RAP 伴生类型此前会生成无法 push 的假草稿；现在明确报 `TYPE_NOT_SUPPORTED` 并提示改用 `create --file`。

### Security

- **Node.js 运行时要求**：必须使用已修复 Brotli 越界写漏洞的版本（22.23.4+ / 24.22.1+ / 26.12.1+）；Node 18/20 不再支持。`abap doctor` 会检查运行时并给出升级建议。

### Removed (breaking)

- **旧 feedback 命令**：自建反馈服务下线；反馈改为直接提 GitHub issue（`gh issue create` 或预填 issue URL），离线留档继续用 `abap report-stuck`。
- **HTTP 本地文件的 `url` 字段改名 `servicePath`**：与 SAP 官方 AFF 格式一致；旧文件会被 `validate:aff` / `push` 拒绝，重新 `abap pull --overwrite` 或手动改名即可。
- **Node.js 18 / 20 及未打补丁的 22 / 24 / 26**：不再受支持。

**Migration**：

- 升级 CLI 后执行一次 `abap deploy --yes`，刷新 ICF 服务（新增 VIEW / SHLP / XSLT / TRAN 写路径与长文本端点）。
- 脚本里的旧 feedback 调用改为 `gh issue create --repo chunrichi/abap-cli ...`（没有 GitHub 凭据时用预填 issue URL）。
- `.http.json` 的 `url` / `generalInformation.url` 改名为 `servicePath`，或 `abap pull <name> --type HTTP --overwrite`。
- Node.js 升级到 22.23.4+ / 24.22.1+ / 26.12.1+。

## [1.0.0] - 2026-10-30

首个公开稳定版：CLI 契约、npm 包与内置 ICF 服务版本从此以本版本为准。

### Added

- **统一的 CLI 契约**：每个命令都支持 `--json` 与 `--schema`，使用稳定的退出码与结构化错误；文档由命令 schema 生成并校验，agent 可直接按 schema 调用。
- **完整的开发闭环**：pull / push / check / diff / create / delete / activate / transport，以及内置 ICF 服务提供的 DDIC、表数据、报表、MIME、文本池等 ADT 未覆盖的读能力。
- **`abap deploy --dev`**：维护者可用开发形态逐类检查、激活内置 ICF 服务。

### Changed

- **版本号统一**：npm 包、ICF 服务与 CHANGELOG 统一为 1.0.0，结束 0.x 时代 package 与 ICF service 版本分离的历史。
- **内置 ICF 服务维护形态**：开发期按全局类树迭代，发布时合并回单类，SAP 系统上只安装 3 个全局对象。
- **keychain 默认使用系统原生后端**：macOS / Windows / Linux 优先使用系统凭据存储，跨 Node 升级更稳定。

### Fixed

- **macOS 反复弹出钥匙串授权窗口**：改用系统原生 keychain 后，读取密码不再每次要求授权。

### Removed (breaking)

- **extensions 扩展机制**：删除 `abap extensions` 命令、配置字段与相关错误码；依赖扩展 hook 的流程需在 CLI 外实现。
- **deprecated 别名与兼容开关**：`--max`（改用 `--limit`）、`--system`（改用 `--profile`）、`--type SICF`（改用 `--type HTTP`）等不再接受。
- **0.x 版本线**：0.1.0–0.2.8 已从 npm 下线，不可复用；请安装 `abap-cli@1.0.0`。
- **认证方式仅保留 basic auth**：移除证书 / SSO / OAuth 登录及相关参数；依赖 BTP trial、SAML SSO 或 X.509 的环境无法连接。
- **本地文件布局改为 AFF 扁平布局**：产物直接平铺在输出目录，文件名形如 `<name>.<type>...`；命名空间对象使用 `(ui2)cl_json` 形式，旧的 `#` 写法不再识别。
- **移除 CA store 的客户端证书导入**：只保留 `--ca` 的 CA 导入/回收。

**Migration**：

- 已部署 ICF 服务的系统执行一次 `abap deploy --yes`。
- 旧工作区重新 `abap pull`：产物会写到新的扁平布局，旧的嵌套目录可直接删除。
- 旧认证方式的 profile 执行 `abap profile set <name> --password <pwd>` 转为 basic，或删除重建。
- 旧 keychain 的 cert-passphrase 条目不再使用，可手动清理。
- 旧 `profile export` bundle（version 2）需用 basic profile 重新导出/导入。

### History

0.1.0–0.2.8 的逐版本记录随旧 git 历史归档（不再参与本仓库的版本叙事）；npm 上对应版本已全部下线。
