# abap-cli Release Handoff 模板

> 复制本文件 → `tmp/handoff/yyyymmddHHMM-done-release-X.Y.Z.md` → 改 §0 / §1 / §2 / §5 / §6 / §7 / §8。
> 模板源自 `tmp/handoff/202609172200-done-release-0.2.7.md` + `tmp/handoff/202609190235-done-release-0.2.8.md`。

---

```markdown
# Handoff — abap-cli release X.Y.Z（done）

> **状态**：🟢 DONE — <YYYY-MM-DD>。npm `abap-cli@X.Y.Z` 已 publish,Actions run `<RUN_ID>` 成功。
> **适用**：下次 release 直接按 `tmp/handoff/20260904-wip1-release-process.md` §6 SOP 走。
> **目标读者**：完全没有上下文的下一个 agent。

---

## 0. TL;DR

| 阶段 | 结果 | 入口 |
|---|---|---|
| merge main → dev | ✅ commit `<SHA>` | 本地 merge (no PR) |
| release commit | ✅ `<SHA>` `chore(release): X.Y.Z` | dev |
| skills drift fix | ✅ amend 进 `<SHA>`(同一 commit) | dev |
| PR #N (dev → main) | ✅ merged `<SHA>` | <PR_URL> |
| tag `vX.Y.Z` | ✅ pushed | <RELEASE_URL> |
| Actions run | ✅ `<RUN_ID>` success (<DURATION>s) | publish-to-npm |
| npm publish | ✅ OIDC Trusted Publishing,~3 分钟 propagation | <NPM_URL> |
| `dist-tags.latest` | ✅ `X.Y.Z` | npm view abap-cli dist-tags |
| `abap --version` (smoke) | ✅ `X.Y.Z` | npm install -g abap-cli@X.Y.Z |

---

## 1. 背景

<简述上一版本到本次的累积工作：commits 数 / 文件改动 / 主题分类>

---

## 2. 进度

### ✅ 已完成

- [x] <步骤 1: merge main → dev>
- [x] <步骤 2: [Unreleased] 审计>
- [x] <步骤 3: npm run verify>
- [x] <步骤 4: CHANGELOG 固化 + bump>
- [x] <步骤 5: skills drift fix>
- [x] <步骤 6: release commit>
- [x] <步骤 7: push + PR>
- [x] <步骤 8: merge + tag>
- [x] <步骤 9: Actions run success + npm propagation>
- [x] <步骤 10: smoke + handoff>

### ⏳ 进行中

无。

### ❌ 未完成（无）

无。

---

## 3. 当前卡点

**无 agent-侧阻塞**。

---

## 4. 下一步计划

1. **下笔工作**：正常开新 commit,塞进 `[Unreleased]` 段(目前是空块)
2. **下次 release**：直接按 0.2.5 SOP §6 走

---

## 5. 重要事项 / 需要决策

| # | 项目 | 备注 |
|---|---|---|
| 1 | <本次 release 的关键决策点> | <说明> |
| 2 | <与上次的差异> | <说明> |

---

## 6. Actions run 详情

```
Run <RUN_ID>
Trigger: push (tag vX.Y.Z)
Workflow: publish-to-npm
Started:  <ISO>
Ended:    <ISO> (<DURATION>s)
Conclusion: success

Steps (all ✓):
  1. Set up job
  2. Checkout
  3. Setup Node.js (Node 24)
  4. Install libsecret for keytar
  5. Install dependencies (npm ci)
  6. Resolve package version (X.Y.Z)
  7. Check if version is already published (404 → not published)
  8. Publish to npm (npm publish --registry=https://registry.npmjs.org)
  9. Dry-run summary (skipped — not workflow_dispatch)

Annotation: <Node.js 20 deprecation warning / etc.>
```

---

## 7. PR 列表

### PR #N: dev → main

- Title: `release: X.Y.Z`
- URL: <PR_URL>
- Merge commit: `<SHA>`
- Files: <+/-/>
- Commits: <N>

---

## 8. commit list

```
<SHA1>  <subject1>
<SHA2>  <subject2>
...
```

---

## 9. 给下一个 agent 的速读

**X.Y.Z release 状态**:
- 仓库 HEAD 在 main,tag `vX.Y.Z` 已 push(指向 `<SHA>`)
- npm `abap-cli@X.Y.Z` 已 publish(`dist-tags.latest = X.Y.Z`)
- Actions run `<RUN_ID>` success
- `[Unreleased]` 段空,下笔工作从这里开始累计

**下次 release**:
- 直接按 0.2.5 SOP §6 走(`tmp/handoff/20260904-wip1-release-process.md`)

**Actions 历史**:
- `<RUN_ID_1>` — <version + result>
- `<RUN_ID_2>` — <version + result>
- `<RUN_ID_N>` — <本次>
```

---

## 章节必填项

| § | 必填 | 来源 |
|---|---|---|
| 0 | TL;DR 表格 9 行 | `gh run view <id> --json ...` + `npm view` |
| 1 | 一句话描述主题 | git log `v_prev..HEAD --oneline` 总结 |
| 2 | 10 步全列 | 按 SOP §6 |
| 5 | 决策表（≥3 行） | 本次 release 的特殊决策 |
| 6 | 9 个 step 全列 | `gh run view <id> --log` |
| 7 | PR title / URL / merge SHA | `gh pr view` |
| 8 | commit 列表 | `git log v_prev..HEAD --oneline` |