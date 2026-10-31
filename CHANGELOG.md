# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组；breaking 变更在 `Removed` 标记并附 **Migration**。

## [Unreleased]

### Added

- **`abap deploy --dev`**：安装内置 ICF 服务的开发形态 — `abap/src` 的 19 个类全部作为全局对象按依赖顺序安装，供维护者在真机上做单类语法检查 / 激活 / 迭代；发布形态仍由不带 `--dev` 的 `abap deploy` 产出。

### Changed

- **内置 ICF 服务按"开发期全局类树 / 发布期合并单类"维护**：`abap/src` 现在是 19 个开发期全局类（handler + 共享类型 + 10 个域 helper + 5 个 format + setup/runner），`abap/deploy.json` 是唯一清单；`abap deploy` 在推送前把 16 个 helper 降级为 `lcl_*` 本地类、按依赖顺序合并进 handler 的 definitions / implementations，SAP 上只装 3 个全局类。`abap deploy` 的结果新增 `mode: "dev" | "release"` 与 `mergedClasses`；清单缺失 / 不一致分别给 `DEPLOY_MANIFEST_MISSING` warning 与 `DEPLOY_MANIFEST_INVALID` 错误。ICF 端点与服务版本不变（仍 `1.0.0`）。**Migration**：升级后执行一次 `abap deploy --yes` 刷新 handler；旧系统上残留的 helper 全局类不再被引用、无需删除。
- **keychain 后端默认改为原生实现**：默认先探测原生后端（macOS `/usr/bin/security`、Windows `cmdkey.exe`、Linux `secret-tool`），仅在原生不可用时回退 `keytar`；`ABAP_CLI_KEYCHAIN_BACKEND` 仍可强制指定。原生后端把条目的可信应用绑定到系统签名 helper，跨 Node 升级稳定；`keytar` 绑定 node 二进制的 cdhash，Homebrew 升级 node 后 ACL 失效。**Migration**：旧 `keytar` 条目仍可读（service/account 命名一致）；macOS 上建议在普通终端执行一次 `abap profile set <name> --password <pwd>` 重建密码条目，再 `security delete-generic-password -a abap-cli/session-key -s abap-cli` 并重跑一次命令重建会话密钥。
- **macOS 写入已存在的 keychain 条目改为重建**：`security add-generic-password` 返回退出码 45（条目已存在）时先删除再创建，使 ACL 重新绑定 `/usr/bin/security`；受限/沙箱 shell 写 login keychain 被拒时，错误信息提示改用普通终端。

### Fixed

- **`create local` 对 CDS/RAP 伴生类型写到错误文件**：`SRVD` / `DCLS` / `DDLX` / `DDLA` 有 `createObjtype` 但没有本地骨架模板，旧实现会落一个 `REPORT <name>.` 内容的 `<name>.<type>.abap`（既不是合法 AFF 草稿也无法 push）。现在 `create local` 对这四类返回 `TYPE_NOT_SUPPORTED`（exit 7）并提示用 `abap create <type> <name> --file <aff.json>`，`--help` 与 README 的"支持 CDS/RAP 配套对象"文案同步更正。
- **macOS 反复弹出的钥匙串授权窗口**：旧条目由 `keytar` 写入，ACL 只信任创建时的 node 二进制；回退到原生 `security` 读取时每次访问都会触发系统授权弹窗。现在 macOS 默认用原生 `security` 写入/读取，条目由 `/usr/bin/security`（Apple 签名）创建，读取不再弹窗。

### Security

- **Node.js Brotli 解码器越界写（CVE-2026-111497）**：CLI 在进程内解压 SAP HTTP 响应（axios 默认解码 `Content-Encoding: br`），未打补丁的 Node.js 运行时会被构造的响应破坏进程；`engines.node` 因此收紧为 `^22.23.4 || ^24.22.1 || >=26.12.1`，`abap doctor` 的 `env.node` 检查、README 与入门文档同步收紧。

### Removed (breaking)

- **Node.js 18 / 20 及未打补丁的 22 / 24 / 26 运行时**：不再受支持 —— 这些版本的 Brotli 解码器未修复，EOL 版本也不会再收到修复。
- **类型/对象子目录布局**：删除 `src/<typeFolder>/<objectName>/` 嵌套布局与 `formats/type-folder.ts#folderFor`。所有 `pull` / `create` / `create local` 产物直接平铺在输出目录（默认 `src/`），文件名遵循 abap-file-format：`<name>.<type>[.<sub_type>][.<content_type>][.<language>].<ext>`（如 `src/zcl_my_class.clas.json` + `src/zcl_my_class.clas.abap`、`src/ztabl_demo.tabl.json` + `.tabl.ddic` + `.tabl.settings.json`、`src/zfg.fugr.saplzfg.reps.abap`、`src/zprog.prog.texts.en.properties`）。`abap types` 输出删除 FOLDER 列/字段。bundled `abap/src/clas/*` 同步扁平为 `abap/src/*`。
- **abapGit `#` 命名空间转义**：命名空间对象落盘从 `#ui2#cl_json` 改为 AFF 规范的括号形式 `(ui2)cl_json`（`/UI2/CL_JSON` → `src/(ui2)cl_json.clas.abap`）；旧 `#` token 不再识别，push 报 `FILE_PARSE_ERROR` 并提示重新 `abap pull`。
- **非 basic 认证方式**：删除 `cert`（X.509 mTLS）、`browser_sso`（浏览器 SSO cookie）、`oauth_password`（BTP UAA password grant）、`sso`（Kerberos/SPNEGO）四种登录方式及全部实现（`auth/` 策略层、SSO cookie/loopback、SPNEGO、BTP service-key 解析）。CLI 只支持 basic auth：SAP username + OS keychain 密码。`--ca` / `--insecure` 保留（TLS 信任配置，不是认证方式）。
- **认证相关命令面**：`abap profile login` / `abap profile cookie` 子命令；`--auth-method` / `--auth-option` / `--cert-path` / `--cert-key` / `--cert-ca` / `--cert-passphrase` / `--remove-cert-passphrase` / `--clear-cert-auth` / `--sso-cookie-file` / `--clear-sso-cookie-file` / `--service-key` / `--clear-oauth-password` / `--spn` / `--reauth-on-expiry` 参数；keychain 的 cert-passphrase 条目读写。
- **profile 输出/格式**：profile JSON 不再含 `auth` 字段；`profile show` 不再输出 `auth` / `certPassphrase*`，`profile delete` 不再返回 `certPassphraseCleaned` / `cookieJarCleaned`；`profile export` bundle 版本 2 → 3；`profile test` 各层不再带 `authMethod`。
- **CA store**：删除客户端证书/私钥导入（`--cert-path` / `--cert-key` / `--cert-ca`）；只保留 `--ca` 的 CA 导入/回收。

**Migration**：

- **本地布局**：旧工作区重新 `abap pull` 即可把产物写到 `src/` 平铺布局；旧的 `src/<type>/<object>/` 嵌套目录不再写入，可直接删除。旧的 `#ui2#cl_json` 命名空间文件必须重新 pull 后才能 push（push 会拒绝 `#` token 并给出迁移提示）。依赖旧路径的脚本 / CI 改用 AFF 文件名，或读 `abap pull --json` 的 `written[]`。
- **`abap/src` 布局**：bundled 源码随 npm 包升级自动使用扁平布局，无需手动整理；已部署的 ICF 服务照常 `abap deploy --yes` 更新。
- 旧 profile（`~/.abap-cli/systems.json` 中 `authMethod` / `auth` 为 cert/browser_sso/oauth_password/sso）仍可读取，`profile list` / `show` 会标注；连接类命令报 `CONFIG_ERROR`。迁移：`abap profile set <name> --password <pwd>`（转为 basic，下一次写入即丢弃旧 auth 字段）或 `profile delete` 后重建。
- 旧 keychain 的 cert-passphrase 条目需手动清理（`abap profile delete` 不再删除它）。
- 旧 `profile export` bundle（version 2）中带旧 auth 的条目在 `import` 时被拒绝；用 basic profile 重新导出/导入。
- 依赖 BTP trial / SAML / X.509 认证的系统在 basic-only 下无法登录；请使用支持 basic auth 的 on-prem/ADT 端点，或等待认证方式重新引入。
- **Node.js 运行时**：升级到 22.23.4+ / 24.22.1+ / 26.12.1+（或更新的受支持版本线），然后重新运行；`abap doctor` 会指出不合规的运行时并给出升级建议。

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
