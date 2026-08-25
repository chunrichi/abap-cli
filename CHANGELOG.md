# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六类按版本分组。Breaking 变更同时在 `Removed` 与 `Migration` 列出。

## [Unreleased]

### Added
- **030 — ADT runtime 分层 + Steampunk `extension deploy` 分流**：新 `src/abap_cli/adc/runtime-probe.ts` 探测三档 ADT runtime（`netweaver740` / `netweaver750` / `steampunk` / `unknown`），依据 `/sap/bc/adt/repository/informationsystem` Atom XML 的 `sap-component`（首选，trial 上 404）+ `/sap/bc/adt/discovery` workspace 的 `/sap/bc/adt/icf/*` collection 缺失 + `Steampunk` / `hana.ondemand` / `abap-env` 关键字（备用，**trial 上是这一支**）。`IcfDeploymentInfo` 加 `runtime` + `icfSetupBlocked` 字段；`extension status` JSON 输出含 `runtime` / `icfSetupBlocked`；`extension deploy` 在 Steampunk 下走 `deployKind: "source-only"`，sources 照常 deploy，ICF 节点注册改为 `meta.warnings[].code: "STEAMPUNK_ICF_MANUAL"` + human 输出 Cloud Foundry destination 步骤（不抛错）。on-prem 用户行为**完全无感**（仍走 `cl_icf_tree`）。**真 BTP trial 验证**：4 个 CLAS（`ZCL_ABAP_VIBE_ICF` / `_ICF_SETUP` / `_RUNNER` / `_TABL_FORMAT`）deploy 成功（`changedAt` 17875882xx = 2026-08-25），`/sap/bc/adt/discovery` 返回 444KB / 940 collections / 0 个 `/sap/bc/adt/icf` / 8 个 Steampunk 关键字命中。设计 + 决策见 `specs/030-btp-ext-deploy-strategy/spec.md`。
- **`src/abap_cli/clients/create-object.ts`**：BTP-safe CLAS / INTF / PROG / FUGR create wrapper。等价复刻 `abap-adt-api` `createBodySimple` 的 XML body（root element + `<adtcore:packageRef>` + on-prem 包加 `<adtcore:uri>`），加 BTP 必需的 `<class:include class:includeType="testclasses"/>` + `<class:superClassRef/>`，Content-Type 改 `application/vnd.sap.adt.oo.classes.v4+xml`。`AdtClientWrapper.createObject` 默认走 wrapper；设 `ABAP_CLI_LEGACY_CREATE=1` 退回 library。
- **`auth/sso-loopback.ts`**（026 重做）：删除旧 helper-page "粘 Cookie header" 流程。`abap profile login <name>` 启 127.0.0.1 loopback listener + open browser 到 `<url>/sap/bc/adt/core/http/reentranceticket?redirect-url=…&sap-client=…&_=…`，按 Eclipse 形态捕获 cookie。
- **auth 认证策略模式重构**：`auth/adapter.ts` 拆为薄 dispatcher + `auth/strategy.ts` registry + `auth/strategies/{basic,cert,browser-sso,oauth-password}.ts`（side-effect 自注册，`registry-bootstrap.ts` 聚合）。新增通用 `--auth-option key=value` flag（可重复）：新认证方法无需新增 Commander option，从 bag 读字段。401/403 hints 由各 strategy 自带（`http-error.ts` 不再维护 per-method 常量）。`config/secrets.ts` 包一层 `SecretsBackend` 接口（当前仅 keytar），公共 API 签名不变。

### Changed
- **`oauth_password` 密码查找链调整**：`init-flow.resolvePassword` 与 `auth/strategies/oauth-password.ts` 现在按 **`OS keychain` → `--password` → TTY prompt** 查找（TTY prompt 输入后自动 store 到 keychain）。`init` wizard 在 `oauth_password` 也走 keychain prompt/store 流程（之前只对 `basic` 生效）。验证：`unset BTP_PASSWORD* && abap profile test btptrial` 直接从 keychain 取密码，tls/auth/adt 全 ok。
- **create-object body 去掉 `adtcore:responsible` 属性**：实测 BTP trial `CLASS_TRANSFORMATION` ST 拒绝带 `adtcore:responsible` 的 body（offset ≈370）。保留 comments 解释原因 + 验证记录。
- **CHANGELOG 压缩**：将 [Unreleased] 区段从 025 → 028 累积的 100+ 行展开压成核心条目。025 / 026 / 027 / 028 / extension / trial-real 诊断等已 release 的内容整体下移到 `docs/CHANGELOG-history.md`（即将提交）。

### Removed
- **移除所有 env 密码读取**（breaking）：`SAP_PASSWORD` / `SAP_PASSWORD_<PROFILE>` / `BTP_PASSWORD` / `BTP_PASSWORD_<PROFILE>` / `CERT_PASSPHRASE_<PROFILE>` / `ABAP_CLI_SECRETS_BACKEND` 不再被读取。密码只来自 `--password` flag、OS keychain、TTY prompt。
  - **Migration**：CI / headless 脚本若依赖 env 密码，改为在启动时 `abap profile set <name> --password <pw>` 写入 keychain，或每次命令传 `--password`。

### Known limitations
- **BTP trial `extension deploy` 仅 source-only**（030 spec）：`cl_icf_tree` / `cx_for_icf_tree` / `ICFHOSTNUM` 是 Steampunk Released APIs 白名单禁（`LA(020)`），无法自动注册 SICF 服务。CLI 探测 runtime 后分流：on-prem 走 `cl_icf_tree`（现状），Steampunk 仅 deploy sources 并把 ICF 节点注册移到 CF destination（自动 hint 输出到 `meta.warnings`）。设计细节见 `specs/030-btp-ext-deploy-strategy/spec.md`。`create` / `push` / `activate` / `inspect` / `transport` / `profile test` / `search` 在 trial 全跑通。
- **BTP trial `reentranceticket` 当前不接受裸调**：需 abap-web 已设的 session cookie，CLI 单端点无法复刻 Eclipse 完整 OAuth2 PKCE chain（web-router client secret 在 SAP server 端，且 trial service-key 的 `redirect_uri` 不接受 `127.0.0.1`）。新 `sso-loopback.ts` 在 trial 上卡在 abap-web 不自动跳 loopback；未来 abap-web 改 redirect 行为或 SAP 开放 web-router code-exchange endpoint 时无需改动即可工作。trial 上唯一自动化 SSO 是 `oauth_password`。

## [0.2.0] - 2026-08-20