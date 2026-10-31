# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组；breaking 变更在 `Removed` 标记并附 **Migration**。

## [Unreleased]

### Added

- **`DOMA` / `DTEL` 长文本伴生文件（`.docu.json`）**：vendored AFF `docu-v1.json`，本地 0..1 伴生文件为 `<name>.doma.docu.json` / `<name>.dtel.docu.json`（`{ formatVersion, lines: [{ format, line }] }`，单语言=对象主语言，SAPscript 标记原样保留）。`abap pull <name> --type DOMA|DTEL` 在主文件落盘后经 ICF `GET /ddic/<type>/<name>/docu` 拉长文本并写伴生：有文档才写，`DOCU_NOT_FOUND` 不写；默认不动本地陈旧伴生，`--overwrite` 时远端无文本则删除本地伴生并给 `DOCU_LOCAL_STALE_REMOVED` warning；docu 端点失败只记 `DOCU_PULL_FAILED` warning，主对象 pull 照常成功（没有该路由的旧 ICF 部署静默视为无文档）。`abap push <name>.<type>.json` 在主对象成功后自动推送同目录伴生：先按 `docu-v1.json` 校验（`line` ≤72、`format` ≤2，超限 `AFF_FIXTURE_INVALID` 且主对象不写），`lines: []` 删除远端长文本（`data.results[].docu = "deleted"`），`--dry-run` 的 plan 追加 `docu-icf` stage，`--atomic` 一并校验伴生；直接 push 伴生文件会以 `INVALID_ARGUMENT` 拒绝并指向主文件。`abap validate:aff` 识别两种伴生后缀（`DOCU` 只是 companion schema，`abap types` / `abap create` 不新增类型）。ICF handler 新增 `/ddic/<type>/<name>/docu` GET/POST，空 `lines` 删除长文本。**Migration**：旧 ICF 部署需 `abap deploy --yes` 刷新 handler 后才有长文本端点；旧本地目录无需迁移（伴生文件缺省即 0..1 可选）。CLI 细节：docu 拉取失败只记 `DOCU_PULL_FAILED` warning（主对象 pull 照常成功，无该路由的旧 ICF 部署静默视为无文档），`--overwrite` 清理陈旧伴生时记 `DOCU_LOCAL_STALE_REMOVED`；`lines: []` push 后 `data.results[].docu = "deleted"`，`--dry-run` 的 plan 追加 `docu-icf`，`--atomic` 一并校验伴生，直接 push 伴生文件以 `INVALID_ARGUMENT` 拒绝并指向主文件；`abap validate:aff` 识别两种伴生后缀（`DOCU` 只是 companion schema，`abap types` / `abap create` 不新增类型）。真机补充：行首 TAB 的文本行经 `DOCU_GET` 读回为空行（SAP 侧行为，缩进请用空格）。
- **`VIEW`（DDIC 数据库视图）对象类型**：新增自建 `view-v1.json`（上游 abap-file-formats 没有 view 格式，按 TTYP 先例在 `schema/README.md` 标注 local extension；字段按 DD25V / DD26V / DD27P / DD28J / DD28V 设计）。ABAP 侧 `/ddic/view/<name>` 提供 GET / POST / PUT / DELETE：读 `DDIF_VIEW_GET`，写 `RS_CORR_INSERT` + `DDIF_VIEW_PUT`（四个 TABLES 参数全部命名，空表也命名）+ `DDIF_VIEW_ACTIVATE`，删除 `RS_DD_DELETE_OBJ(no_ask='X')`（先激活 inactive 版本；仅 `$TMP` 视图，可传输视图请在 SE11 删除以便记录到请求）。CLI 侧注册 VIEW（`abap types` 类型数 22→23，`create --schema VIEW` 带 exampleJson），`abap create / pull / push / delete VIEW` 端到端可用；`push` 仍是 update-only（先 GET 探测），view 名按 DDIC 限制 ≤16 字符、非 `$TMP` 写要求 `--tr`。单元测试 + mock ICF 生命周期测试覆盖；S/4HANA 真机六阶段回归 17/17 TC 通过（两表 join 视图 create/pull/push/delete、DD25L/DD26S/DD27S/DD28S 落库校验、视图本身可查、单表视图与错误路径；证据 `tests/261031006-realsap-view/`，本地不入库）。- **`TRAN`（事务码 / SE93）写路径**：ABAP `/tran/<code>` 新增 POST/PUT（创建或覆盖）与 DELETE。写路径按 SE93 数据模型落 TSTC/TSTCT/TSTCP/TSTCC/TSTCA + TADIR：已存在的事务码先清空五张事务表，再经 `RS_CORR_INSERT`（package/transport 绑定）与 `RPY_TRANSACTION_INSERT`（`suppress_corr_insert`）重建定义，随后覆盖 TSTCC 的用户界面属性、补 report variant 的 CINFO x'10' 位并写 TSTCA 起始授权对象。支持 dialog / report（含 report variant）/ parameter / variant 四类事务；**OO 事务返回 `TRAN_OO_NOT_SUPPORTED`**（规范 FM 无 class/method 参数，仍用 SE93 维护）。`abap create TRAN` / `abap push *.tran.json` / `abap delete <code> --type TRAN` 因此端到端可用；删除仅支持 `$TMP` 事务（可传输事务请在 SE93 删除，以便把删除记录进请求）。**Migration**：此前 `pull TRAN` 在真实系统上会因读取端类型截断与 TSTCP 解析错误产生空/非法 AFF 文档，现在重新 `abap pull <code> --type TRAN --overwrite` 即可；旧的手工 `.tran.json` 若要 push，需要补 `header.abapLanguageVersion` 或整块 `generalInformation` 的空默认值（`lockStatus` 等）——直接重新 pull 最省事。读取端同时修正：`parameterTransaction`/`variantTransaction` 不再因 17 字符变量截断而丢块，TSTCP 单行前缀编码（`/*<core> NAME=VALUE;`、`@@<core> <variant>`、report variant 名）被正确解析，GET 输出带 `package` 供 push 复用。
- **`DEVC`（Package）对象类型**：`abap create DEVC <name> --package <super> --description ...` 经 ADT `POST /sap/bc/adt/packages` 创建 `DEVC/K` 包（`--software-component` / `--transport-layer` / `--package-type`，缺省从父包继承；`--check-only` 走 SAP 的 `POST /sap/bc/adt/packages/validation` 预检；软件组件为 `LOCAL` 时包名必须 `$`/`TEST` 开头）；`abap pull <name> --type DEVC` 读 `GET /sap/bc/adt/packages/<name>` 落 AFF `<name>.devc.json`（`superPackage` / `switch` / `applicationComponent` / `softwareComponent` / `transportLayer` / 包属性 / ABAP 语言版本 / `useAccesses`）；`abap delete --type DEVC` 走无锁删除（transportable 包按软件组件要求 `--tr`；stale 会话锁自动换会话重试）。**push 不支持**：ADT 资源控制器拒绝 `PUT /sap/bc/adt/packages/<name>`，`abap push *.devc.json` 返回 `TYPE_NOT_SUPPORTED`（exit 7）。vendored AFF schema 新增 `devc-v1.json`，类型矩阵 / `abap types` / `create --schema` 同步为 22 类。
- **`abap test`**：跑 ABAP Unit 单测 — 经 ADT ABAP Unit 端点运行类/程序测试，只输出 summary 与失败用例（通过用例不逐条列出）；失败 exit 7（`TEST_FAILED`，`details` 带 summary + failures）。支持 `--type`（解析过滤）、`--risk`（harmless,dangerous,critical，默认 harmless）、`--duration`（short,medium,long，默认 short）、`--all`（全等级）、`--strict`（warning 视为失败）。只读：不加锁、不写 transport。归 `abap-cli-data` skill。
- **`abap deploy --dev`**：安装内置 ICF 服务的开发形态 — `abap/src` 的 19 个类全部作为全局对象按依赖顺序安装，供维护者在真机上做单类语法检查 / 激活 / 迭代；发布形态仍由不带 `--dev` 的 `abap deploy` 产出。

### Changed

- **vendored AFF schema 对齐上游最新 HEAD**：`src/abap_cli/schema/` 的 23 个上游 schema 现在是 `SAP/abap-file-formats` 的字节级副本（`enqu` 补末尾换行，`http` / `msag` / `tabt` / `tran` 升级到上游新版）；手写的 `ttyp-v1.json` 是唯一本地变体。`nrob-v1.json` 去掉本地加严的 `originalLanguage` `pattern`/`maxLength` 与 `percentWarning` `multipleOf`，回到上游版本——这些约束没有测试或文档依赖，却可能拒绝 SAP 自己产出的 AFF 文档。`msag` 现在要求每条消息带 `number`；`tabt` 的 `sizeCategory` 由 enum 改为等价的 pattern。同步脚本的 `FILES` 列表补上 `ddls` / `msag`，`src/abap_cli/schema/README.md` 重写为逐文件溯源表。
- **内置 ICF 服务按"开发期全局类树 / 发布期合并单类"维护**：`abap/src` 现在是 19 个开发期全局类（handler + 共享类型 + 10 个域 helper + 5 个 format + setup/runner），`abap/deploy.json` 是唯一清单；`abap deploy` 在推送前把 16 个 helper 降级为 `lcl_*` 本地类、按依赖顺序合并进 handler 的 definitions / implementations，SAP 上只装 3 个全局类。`abap deploy` 的结果新增 `mode: "dev" | "release"` 与 `mergedClasses`；清单缺失 / 不一致分别给 `DEPLOY_MANIFEST_MISSING` warning 与 `DEPLOY_MANIFEST_INVALID` 错误。ICF 端点与服务版本不变（仍 `1.0.0`）。**Migration**：升级后执行一次 `abap deploy --yes` 刷新 handler；旧系统上残留的 helper 全局类不再被引用、无需删除。
- **keychain 后端默认改为原生实现**：默认先探测原生后端（macOS `/usr/bin/security`、Windows `cmdkey.exe`、Linux `secret-tool`），仅在原生不可用时回退 `keytar`；`ABAP_CLI_KEYCHAIN_BACKEND` 仍可强制指定。原生后端把条目的可信应用绑定到系统签名 helper，跨 Node 升级稳定；`keytar` 绑定 node 二进制的 cdhash，Homebrew 升级 node 后 ACL 失效。**Migration**：旧 `keytar` 条目仍可读（service/account 命名一致）；macOS 上建议在普通终端执行一次 `abap profile set <name> --password <pwd>` 重建密码条目，再 `security delete-generic-password -a abap-cli/session-key -s abap-cli` 并重跑一次命令重建会话密钥。
- **macOS 写入已存在的 keychain 条目改为重建**：`security add-generic-password` 返回退出码 45（条目已存在）时先删除再创建，使 ACL 重新绑定 `/usr/bin/security`；受限/沙箱 shell 写 login keychain 被拒时，错误信息提示改用普通终端。

### Fixed

- **匿名 ICM 上下文被误判为“只能 stateless”**：上一轮修复把带匿名 `sap-contextid` 的登录降级成 stateless，导致所有需要锁的 ADT 操作（`abap deploy`、`abap push`、DDIC `abap delete`）直接报 `This operation can only be performed in stateful mode`，真机部署与清理被完全阻塞。实测服务器在**不带匿名 cookie** 的 stateful 请求上会按需创建会话：现在只丢弃匿名 cookie、保持 stateful 会话模式，锁操作恢复正常；（此前观察到 `400 Session not found` 的根因就是回放该匿名 cookie，而不是 stateful 不可用）。
- **探针命令与失败命令会把 stateful 会话留在 SAP（SM04 会话堆积）**：`profile test` / `init` 的连通性探针为每个探测层、每个能力检查各建一个裸 `ADTClient` 并 `login()`，却从不 logout——一次 `profile test` 最多留下 10 个 stateful 会话。同时 `printError` 直接 `process.exit()`，绕过了 commander 的 `postAction` 清理钩子，所有失败命令（测试/回归里最频繁的路径）各留一个会话。堆积的会话占满 ICM 会话表后，登录只下发匿名 `sap-contextid`，随后所有 stateful ADT 请求以 `400 Session not found` 失败。现在探针共用一个登录（`withRawAdtSession`，`profile test` 从最多 10 次登录降到 1 次）并在 `finally` 释放；`printError` 改为抛 `CliExit`，顶层在退出前统一跑 `runEndOfCommandCleanup`；`clearJarFromDisk` 同时清理 `$TMPDIR` 回退 jar；`always-logout` 不再删除其它进程正在使用的共享 session jar。
- **会话复用把匿名 ICM 上下文 cookie 回放给 ADT，导致 `400 Session not found`**：ICM 在 stateless 请求上会下发 `sap-contextid=SID:ANON:…`，旧实现把它连同其他 cookie 存进 session jar 并在后续请求里回放；ADT 的 stateful 请求带上匿名上下文后被 SAP 直接拒绝（真机 S/4HANA 8.134 实测，`abap status` / `inspect` / `push` / `run` 全部失败，而 stateless 的 curl 正常）。现在 capture / inject / 首次登录后都会丢弃匿名 `sap-contextid`，既不落盘也不发送。
- **DDIC 创建/推送在真实 SAP 上因 AFF camelCase 载荷反序列化失败**：ICF 的 `create_ddic_{domain,data_element,table,structure}` 反序列化 AFF 载荷时未启用 `pretty_mode-camel_case`，`header` / `generalInformation` / `dataTypeInformation` / `format.dataType` 等字段全部落空——真机 `abap create DOMA/DTEL/TABL/STRU` 分别报 `Data type ' ' does not exist`、`DTEL ... unsupported category:`、`unsupported TABT translation value`。现在四个写路径统一按 AFF 命名反序列化；DTEL 读写路径改为 AFF 嵌套的 `dataTypeInformation.predefinedType`（读回来的 `.dtel.json` 可再次 push）；TABL 的 TABT 技术设置（`logChanges` / `translation` / `buffering` / `dbSpecificSettings`）写入 active DD09L 记录（`DDIF_TABL_PUT` + `DDIF_TABL_ACTIVATE` 对已存在表返回 `rc=8`、切换不了设置），`abap pull` 读回与 SE11 一致。**Migration**：升级后 `abap deploy --yes` 刷新 ICF 服务；已部署过旧版 handler 的会话可能继续命中内存里的旧 class load，真机验证请用 `ABAP_CLI_SESSION_POLICY=always-logout` 开新会话。
- **HTTP pull 在真实 SAP 上因描述超长 / CLI 信封字段失败**：`ICFDOCU.ICF_DOCU` 是定长 CHAR，且真实 SICF 节点的描述可能超过 AFF `header.description` 的 60 字符上限（真机实测为 `节点名 + GUID + 文本`）；同时 pull 会把 CLI 信封 `name` 落进 `.http.json`。两者都会让刚拉下来的文件过不了 `validate:aff` / 写前钩子。现在 pull 对描述 `trim` + 截断到 60，且不再落 CLI 信封字段。**Migration**：旧 `.http.json` 里的 `name` / `serviceId` / `descriptionByLang` 字段会被 `push` / `validate:aff` 拒绝；删除这些字段或重新 `abap pull --overwrite` 即可（描述被截断到 60 字符）。
- **HTTP pull 把 SICF 扩展字段写进本地 AFF 文件导致写盘校验失败**：`pull HTTP` 会把读路径的 `generalInformation.serviceId` 与 `header.descriptionByLang[]` 落进 `.http.json`，而 vendored `http-v1.json` 是 `additionalProperties:false`，写前钩子会以 `AFF_FIXTURE_INVALID` 拒绝——真实 SAP 上 `pull HTTP` 因此不可用。现在本地文件只保留 AFF 字段（`servicePath` 继续映射到 ICF wire 的 `url`），SICF 扩展不再落盘。**Migration**：旧 `.http.json` 若含 `serviceId` / `descriptionByLang`，`push` / `validate:aff` 会报校验失败；删除这两个字段或重新 `abap pull HTTP --overwrite` 即可。
- **`create local` 对 CDS/RAP 伴生类型写到错误文件**：`SRVD` / `DCLS` / `DDLX` / `DDLA` 有 `createObjtype` 但没有本地骨架模板，旧实现会落一个 `REPORT <name>.` 内容的 `<name>.<type>.abap`（既不是合法 AFF 草稿也无法 push）。现在 `create local` 对这四类返回 `TYPE_NOT_SUPPORTED`（exit 7）并提示用 `abap create <type> <name> --file <aff.json>`，`--help` 与 README 的"支持 CDS/RAP 配套对象"文案同步更正。
- **macOS 反复弹出的钥匙串授权窗口**：旧条目由 `keytar` 写入，ACL 只信任创建时的 node 二进制；回退到原生 `security` 读取时每次访问都会触发系统授权弹窗。现在 macOS 默认用原生 `security` 写入/读取，条目由 `/usr/bin/security`（Apple 签名）创建，读取不再弹窗。

### Security

- **Node.js Brotli 解码器越界写（CVE-2026-111497）**：CLI 在进程内解压 SAP HTTP 响应（axios 默认解码 `Content-Encoding: br`），未打补丁的 Node.js 运行时会被构造的响应破坏进程；`engines.node` 因此收紧为 `^22.23.4 || ^24.22.1 || >=26.12.1`，`abap doctor` 的 `env.node` 检查、README 与入门文档同步收紧。

### Removed (breaking)

- **HTTP 本地文件字段 `generalInformation.url` 改名为 `servicePath`**：上游重写了 AFF `http-v1.json`（SICF 路径成员改名，新增可选 `tokenHandling`）。本地 `.http.json` 现在只接受 AFF 的 `servicePath`；`url` 会被 `validate:aff` / `create` / `push` 以 VALIDATION_ERROR 拒绝。ICF 载荷（ABAP handler 的 `ty_http_service_data`）仍用 `url`，转换收敛在 `formats/http/json.ts`，SAP 侧与 ICF 版本不变。
- **Node.js 18 / 20 及未打补丁的 22 / 24 / 26 运行时**：不再受支持 —— 这些版本的 Brotli 解码器未修复，EOL 版本也不会再收到修复。
- **类型/对象子目录布局**：删除 `src/<typeFolder>/<objectName>/` 嵌套布局与 `formats/type-folder.ts#folderFor`。所有 `pull` / `create` / `create local` 产物直接平铺在输出目录（默认 `src/`），文件名遵循 abap-file-format：`<name>.<type>[.<sub_type>][.<content_type>][.<language>].<ext>`（如 `src/zcl_my_class.clas.json` + `src/zcl_my_class.clas.abap`、`src/ztabl_demo.tabl.json` + `.tabl.ddic` + `.tabl.settings.json`、`src/zfg.fugr.saplzfg.reps.abap`、`src/zprog.prog.texts.en.properties`）。`abap types` 输出删除 FOLDER 列/字段。bundled `abap/src/clas/*` 同步扁平为 `abap/src/*`。
- **abapGit `#` 命名空间转义**：命名空间对象落盘从 `#ui2#cl_json` 改为 AFF 规范的括号形式 `(ui2)cl_json`（`/UI2/CL_JSON` → `src/(ui2)cl_json.clas.abap`）；旧 `#` token 不再识别，push 报 `FILE_PARSE_ERROR` 并提示重新 `abap pull`。
- **非 basic 认证方式**：删除 `cert`（X.509 mTLS）、`browser_sso`（浏览器 SSO cookie）、`oauth_password`（BTP UAA password grant）、`sso`（Kerberos/SPNEGO）四种登录方式及全部实现（`auth/` 策略层、SSO cookie/loopback、SPNEGO、BTP service-key 解析）。CLI 只支持 basic auth：SAP username + OS keychain 密码。`--ca` / `--insecure` 保留（TLS 信任配置，不是认证方式）。
- **认证相关命令面**：`abap profile login` / `abap profile cookie` 子命令；`--auth-method` / `--auth-option` / `--cert-path` / `--cert-key` / `--cert-ca` / `--cert-passphrase` / `--remove-cert-passphrase` / `--clear-cert-auth` / `--sso-cookie-file` / `--clear-sso-cookie-file` / `--service-key` / `--clear-oauth-password` / `--spn` / `--reauth-on-expiry` 参数；keychain 的 cert-passphrase 条目读写。
- **profile 输出/格式**：profile JSON 不再含 `auth` 字段；`profile show` 不再输出 `auth` / `certPassphrase*`，`profile delete` 不再返回 `certPassphraseCleaned` / `cookieJarCleaned`；`profile export` bundle 版本 2 → 3；`profile test` 各层不再带 `authMethod`。
- **CA store**：删除客户端证书/私钥导入（`--cert-path` / `--cert-key` / `--cert-ca`）；只保留 `--ca` 的 CA 导入/回收。
- **`abap feedback` 与自建反馈服务**：删除命令、`FeedbackClient` / 反馈 flow，以及 `feedback.example.com` 占位 HTTP 契约（幂等 key、priority、username 解析、`CONFLICT` exit 66 / `PERSISTENCE_ERROR` 67 / `HTTP_ERROR` 68 三个保留错误类别）。反馈改为 agent 直接提 GitHub issue（GitHub MCP / `gh issue create` / `GITHUB_TOKEN`），无凭据时给用户预填 issue URL；离线留档仍用 `abap report-stuck`。

**Migration**：

- **本地布局**：旧工作区重新 `abap pull` 即可把产物写到 `src/` 平铺布局；旧的 `src/<type>/<object>/` 嵌套目录不再写入，可直接删除。旧的 `#ui2#cl_json` 命名空间文件必须重新 pull 后才能 push（push 会拒绝 `#` token 并给出迁移提示）。依赖旧路径的脚本 / CI 改用 AFF 文件名，或读 `abap pull --json` 的 `written[]`。
- **`abap/src` 布局**：bundled 源码随 npm 包升级自动使用扁平布局，无需手动整理；已部署的 ICF 服务照常 `abap deploy --yes` 更新。
- 旧 profile（`~/.abap-cli/systems.json` 中 `authMethod` / `auth` 为 cert/browser_sso/oauth_password/sso）仍可读取，`profile list` / `show` 会标注；连接类命令报 `CONFIG_ERROR`。迁移：`abap profile set <name> --password <pwd>`（转为 basic，下一次写入即丢弃旧 auth 字段）或 `profile delete` 后重建。
- 旧 keychain 的 cert-passphrase 条目需手动清理（`abap profile delete` 不再删除它）。
- 旧 `profile export` bundle（version 2）中带旧 auth 的条目在 `import` 时被拒绝；用 basic profile 重新导出/导入。
- 依赖 BTP trial / SAML / X.509 认证的系统在 basic-only 下无法登录；请使用支持 basic auth 的 on-prem/ADT 端点，或等待认证方式重新引入。
- **Node.js 运行时**：升级到 22.23.4+ / 24.22.1+ / 26.12.1+（或更新的受支持版本线），然后重新运行；`abap doctor` 会指出不合规的运行时并给出升级建议。
- **反馈链路**：脚本 / 文档中的 `abap feedback ...` 调用改为直接建 GitHub issue —— `gh issue create --repo chunrichi/abap-cli --title "..." --body "..."`（或 GitHub MCP 的建 issue 工具、`POST /repos/chunrichi/abap-cli/issues`）；没有 GitHub 凭据时用 `https://github.com/chunrichi/abap-cli/issues/new?title=...&body=...` 预填 URL 交给用户手动提交。退出码 66–68 不再出现。
- **HTTP 本地文件**：把 `.http.json` 的 `generalInformation.url` / 顶层 `url` 改名为 `servicePath`（值不变），或 `abap pull <name> --type HTTP --overwrite` 重新生成；`generalInformation.tokenHandling` 可选，当前 ICF handler 未实现该开关。

## [1.0.0] - 2026-10-30

首个公开稳定版。仓库历史、发布链路与文档体系整体重建；CLI 契约以本版本为准。

### Added

- **统一构建产物**：`npm run build` 输出扁平 `dist/index.js`（`rootDir: src/abap_cli`），npm 包只含 `dist` / `abap/src` / `skills` / `agents`。
- **单一命令注册表**：`src/abap_cli/registry/commands.ts` 是唯一命令清单；drift 检查、文档生成与测试全部从它派生。
- **文档生成与校验**：`npm run docs:build` 从真实 `--schema --json` 输出生成 `docs/commands.md`、skills quick refs、wiki 命令索引与缺失页 stub；`npm run docs:check` 已并入 `npm run verify`，生成物漂移会让 CI 失败。
- **CI 验证闸门**：新增 `verify.yml`（push / PR 跑 `npm run verify`），`publish.yml` 在发布前自行 verify 并校验 tag 与 `package.json` 版本一致。

### Changed

- **版本号单线**：`package.json`、ICF service（`ICF_SERVICE_VERSION` / ABAP `gc_version`）、CHANGELOG 统一为 `1.0.0`，结束 0.2.x 时代 package 与 ICF service 版本分离的历史。
- **根文档与知识库收敛**：`docs/commands.md` 等生成物禁止手改；`wiki/` 默认全量入库（草稿放 `wiki/_local/`）；一次性 feedback 报告、Copilot 指针文件、旧 spec 引用全部移除。
- **构建/验证流程**：新增 `clean`、`docs:build`、`docs:check`；`verify = build + test + docs:check + skills drift`；本地 pre-push hook 只作快速反馈，CI 是权威闸门。

### Removed (breaking)

- **extensions 扩展机制**：删除 `abap extensions`（含 `list` / `lock`）、`src/abap_cli/extensions/`、`.abap.json` 的 `extensions[]` 字段、`meta.extensions` 输出及 `EXTENSION_*` 错误码；命令面收敛为 29 个顶层命令。**Migration**：从 `.abap.json` 删除 `extensions`；依赖扩展 hook 的流程需在 CLI 外实现。未来若重做，另立设计。
- **deprecated 别名与兼容开关**：`--max`（select/search，改用 `--limit`）、`--system`（init，改用 `--profile`）、`--type SICF`（改用 `--type HTTP`）、`ABAP_CLI_LEGACY_CREATE`。**Migration**：替换为 canonical 参数即可。
- **0.x 的 npm 版本线**：0.1.0–0.2.8 已从 npm 下线且版本号不可复用；升级请安装 `abap-cli@1.0.0`。

**Migration（已部署 ICF 服务）**：ICF service 版本从 `0.6.0` 升到 `1.0.0`，执行一次 `abap deploy --yes` 重建/更新服务；旧的 `/sap/zabap_vibe` 节点不会自动删除。

### History

0.1.0–0.2.8 的逐版本变更记录随旧 git 历史归档（不再参与本仓库的版本叙事）；npm 上对应版本已全部下线。
