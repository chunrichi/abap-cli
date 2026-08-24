# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六类按版本分组。Breaking 变更同时在 `Removed` 与 `Migration` 列出。

## [Unreleased]

### Added
- **`src/abap_cli/clients/create-object.ts`**：BTP-safe CLAS / INTF / PROG / FUGR create wrapper。等价复刻 `abap-adt-api` `createBodySimple` 的 XML body（root element + `<adtcore:packageRef>` + on-prem 包加 `<adtcore:uri>`），加 BTP 必需的 `<class:include class:includeType="testclasses"/>` + `<class:superClassRef/>`，Content-Type 改 `application/vnd.sap.adt.oo.classes.v4+xml`。`AdtClientWrapper.createObject` 默认走 wrapper；设 `ABAP_CLI_LEGACY_CREATE=1` 退回 library。
- **`auth/sso-loopback.ts`**（026 重做）：删除旧 helper-page "粘 Cookie header" 流程。`abap profile login <name>` 启 127.0.0.1 loopback listener + open browser 到 `<url>/sap/bc/adt/core/http/reentranceticket?redirect-url=…&sap-client=…&_=…`，按 Eclipse 形态捕获 cookie。

### Changed
- **`oauth_password` 密码查找链调整顺序**：`adapter.readPasswordFromEnv` 与 `init-flow.resolvePassword` 现在按 **`OS keychain` → `BTP_PASSWORD_<PROFILE>` → `BTP_PASSWORD` → TTY prompt** 查找（keychain 优先；env 变成 CI / headless agent 的 override；TTY prompt 输入后自动 store 到 keychain）。`init` wizard 在 `oauth_password` 也走 keychain prompt/store 流程（之前只对 `basic` 生效）。验证：`unset BTP_PASSWORD* && abap profile test btptrial` 直接从 keychain 取密码，tls/auth/adt 全 ok。
- **create-object body 去掉 `adtcore:responsible` 属性**：实测 BTP trial `CLASS_TRANSFORMATION` ST 拒绝带 `adtcore:responsible` 的 body（offset ≈370）。保留 comments 解释原因 + 验证记录。
- **CHANGELOG 压缩**：将 [Unreleased] 区段从 025 → 028 累积的 100+ 行展开压成核心条目。025 / 026 / 027 / 028 / extension / trial-real 诊断等已 release 的内容整体下移到 `docs/CHANGELOG-history.md`（即将提交）。

### Known limitations
- **BTP trial `extension deploy` 暂不通**：内置 ICF setup class `ZCL_ABAP_VIBE_ICF_SETUP` 用 `cl_icf_tree` / `cx_for_icf_tree` / `ICFHOSTNUM`，Steampunk Released APIs 白名单禁，main source 编不过（`LA(020)`）。在 trial 上 `deploy` 卡在 ICF setup 这一步。`create` / `push` / `activate` / `inspect` / `transport` / `profile test` / `search` 已全部在 trial 跑通。`extension deploy` 仍只在 on-prem ECC 工作。
- **BTP trial `reentranceticket` 当前不接受裸调**：需 abap-web 已设的 session cookie，CLI 单端点无法复刻 Eclipse 完整 OAuth2 PKCE chain（web-router client secret 在 SAP server 端，且 trial service-key 的 `redirect_uri` 不接受 `127.0.0.1`）。新 `sso-loopback.ts` 在 trial 上卡在 abap-web 不自动跳 loopback；未来 abap-web 改 redirect 行为或 SAP 开放 web-router code-exchange endpoint 时无需改动即可工作。trial 上唯一自动化 SSO 是 `oauth_password`。

## [0.2.0] - 2026-08-20