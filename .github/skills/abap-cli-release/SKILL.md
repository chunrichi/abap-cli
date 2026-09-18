---
name: abap-cli-release
description: 'Cut a new abap-cli release to npm end-to-end — merge main into dev, audit [Unreleased], bump package.json, fix skills drift, write the release commit, push, open PR, merge, tag vX.Y.Z, monitor CI publish, smoke-test install, write the done handoff. Use when user asks "发布 0.2.x / 1.x.0"、"发布新版本"、"release 到 npm"、"bump version + publish"、"切 tag"、"我要发布"、"publish abap-cli"、"新版本号"、"怎么发版"，or any time the user mentions version number bumps, npm publish workflow, CHANGELOG [Unreleased]→[X.Y.Z], tagging v*, or pushing a release PR to main.'
metadata:
  version: "0.2.8"
  scope: workspace
  triggers: [release, publish, version, bump, tag, npm]
---

# abap-cli — Release 流程

CI 自动 publish (OIDC Trusted Publishing, no token)。流程严格按 dev → PR → main → tag → CI。

**不要**本地 `npm publish`。**不要**在 main 上直接 commit release。**不要**手改 `dist/`。

## 何时使用

- 用户说"发布新版本 / release / 发版 / 切 tag / 升 0.2.x"
- 用户想 bump version 但没说具体流程
- 用户想看 release 流程怎么走
- CI publish run 失败需要 re-tag

## 何时不要使用

- 单次源码改动（→ `abap-cli-edit`）
- 发布完想继续下笔工作（开新 commit 进 `[Unreleased]` 即可，不需要 skill）

## 流程（10 步）

| # | 步骤 | 关键命令 |
|---|---|---|
| 1 | 在 dev 上从 main 拉最新 | `git checkout dev && git fetch origin && git merge origin/main` |
| 2 | 审计 `[Unreleased]` 覆盖 | `git log vX.Y.Z..HEAD --oneline` 比对 |
| 3 | 跑健康检查 | `npm run verify`（206 文件 / 1813 测试 / skills drift） |
| 4 | 填 CHANGELOG `[Unreleased]` + bump `package.json#version` | 见 [references/workflow.md](./references/workflow.md) |
| 5 | skills drift fix（同一 commit 内） | `node scripts/check-skills-drift.mjs --fix` |
| 6 | release commit | `git commit -m "chore(release): X.Y.Z"` |
| 7 | push dev + 开 PR → main | `gh pr create --base main --head dev --title "release: X.Y.Z" --body ""` |
| 8 | merge PR + 在 main HEAD 打 tag + push | `gh pr merge X --merge && git tag -a vX.Y.Z -m "X.Y.Z" && git push origin vX.Y.Z` |
| 9 | 轮询 Actions run + 验 npm | `gh run watch <id>` + `npm view abap-cli@X.Y.Z version --registry=https://registry.npmjs.org` |
| 10 | smoke + 写 done handoff | `npm install -g abap-cli@X.Y.Z && abap --version` |

**详细每一步 + 错误恢复**见 [references/workflow.md](./references/workflow.md)。

## 关键原则

1. **release commit 只动 `CHANGELOG.md` + `package.json` + 6 个 `SKILL.md`**（skills drift 修复已合并进同一 commit，无需 follow-up）。**严禁**夹带源码改动 —— 源码 fix 必须先单独 commit。
2. **skills drift fix 在 release commit 之前完成,同一 commit 一起**。`check-skills-drift.mjs --fix` 自动改 6 个 SKILL.md。
3. **PR title 简写 + body 空**。沿用 `release: X.Y.Z`,不带 bug/spec 编号（[copilot-instructions.md](../../copilot-instructions.md) 规则）。
4. **tag 必须在 main HEAD**,且 origin/main 已包含 PR。先 `git checkout main && git pull --ff-only`,再打 tag。
5. **CI Node 24**,npm ≥ 11.5.1（trusted publishing 门槛）。本地 22.x 也可 publish。
6. **OIDC Trusted Publishing** —— 不要把 NPM_TOKEN 写进任何配置文件。

## 速查：版本号规则

- **patch**（0.2.x → 0.2.x+1）：bug fix / docs / refactor，无 breaking
- **minor**（0.2.x → 0.3.0）：new feature / new CLI command，向后兼容
- **major**（0.x.y → 1.0.0）：breaking change（CHANGELOG `### Removed` 标记 + Migration 段）

PR #16（dev 历史）增加了 21 个 commit 但仍是 patch（0.2.7）—— 因为新增类型全是新增的、`ICF handler split` 是重构、`activate / lock` 是回归修复、不破坏公共 CLI 行为。

## 速查：CHANGELOG 段名

`Added` / `Changed` / `Removed` / `Fixed` / `Security`。Breaking 在 `Removed` 段标并附 Migration。

## 速查：tag 与 Actions run 对应

- `v0.2.7` → run `35232242796`（2026-09-17,43s）
- `v0.2.8` → run `35380618412`（2026-09-18,52s）
- 失败案例：`33978595325`（0.2.6 multi-line script）

`gh run view <id> --log-failed | tail -80` 排错。

## 速查：常见 5 类失败与对策

| 症状 | 原因 | 修法 |
|---|---|---|
| `Cannot find package 'ajv'` | dist 静态 import ajv 但 devDeps 没声明 | ajv → dependencies（0.2.8 起已修） |
| `ERR_DLOPEN_FAILED` 在 CI Linux | keytar 缺 libsecret | workflow `Install libsecret for keytar`（已落） |
| `CONFIG_ERROR` 子进程测试 | spawn 无 `.abap.json` | `withFakeProject()` helper |
| `npm view` 404 持续 3+ 分钟 | registry propagation 延迟 | 等 3-5 分钟重试 |
| `whoami` 401 + publish 404 | npmjs.com token 失效 | 但本项目走 OIDC,走 Actions run `node -p "process.env.NODE_AUTH_TOKEN"` 验证 |

## 完成后必做

1. **写 done handoff**：`tmp/handoff/yyyymmddHHMM-done-release-X.Y.Z.md`（模板见 [references/handoff-template.md](./references/handoff-template.md)）。
2. **记录 Actions run id** + commit + tag 到 handoff §6/§7。
3. **下一笔工作**开新 commit 进 `[Unreleased]` 段空块即可。