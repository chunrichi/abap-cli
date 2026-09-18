# abap-cli Release — 详细流程（10 步）

> 模板源自 `tmp/handoff/20260904-wip1-release-process.md` §6 + 0.2.7/0.2.8 release 实操。

---

## 步骤 1 — 在 dev 上从 main 拉最新

```bash
git checkout dev
git fetch origin --tags
git merge origin/main --no-ff -m "merge: main X.Y.Z release into dev for X.Y.(Z+1) base"
# 若冲突：dev 上的源码 fix 不应改 CHANGELOG/package.json/SKILL.md,
#         main 上的 release commit 是干净的,冲突在 dev 改的 CHANGELOG 段
```

**何时用 `--no-ff`**：dev 与 main 分叉（dev 上有未推送 commit）。若 dev 严格 ff-able,用 `--ff-only`。

**为何不在 dev 上 ff main**：dev 总是有未推送 commit（11+ ahead of origin/dev 是常态），ff 几乎不可能。

---

## 步骤 2 — 审计 `[Unreleased]` 覆盖

```bash
# 上一 tag 之后的所有 commit（不含 tag 本身）
git log vX.Y.Z..HEAD --oneline

# 当前 [Unreleased] 段内容
awk '/^## \[Unreleased\]/{flag=1; next} /^## \[/ {flag=0} flag' CHANGELOG.md
```

逐 commit 比对:
- 每个 Added/Changed/Fixed/Removed commit 是否进了对应段
- commit body 描述的实质变更是否进了 CHANGELOG
- `BREAKING:` 前缀的 commit 必须在 `Removed` 段并附 Migration

**坑**：commit message 中的 "fix #123" / "see spec 04" 不写进 CHANGELOG（[copilot-instructions.md](../../../copilot-instructions.md) 规则）。

---

## 步骤 3 — 跑健康检查

```bash
npm run verify
```

期望输出:
- tsc: 0 errors
- vitest: 206 files / 1813 tests pass
- check-skills-drift: ✓ 无漂移

**CI-only fail 三大类型**(若本地过 CI 挂):
1. spec 依赖（已被 PR #13 修,本项目不应再出）
2. keytar libsecret（已在 workflow 装,不应再出）
3. 子进程 cwd 缺 `.abap.json`（用 `withFakeProject()` helper）

若有 fail：先**单独 commit 修源码**,再做 release commit。

---

## 步骤 4 — 填 CHANGELOG + bump version

### 4a. 写 `[Unreleased]` 段

格式:
```markdown
## [Unreleased]

### Added
- **<feature name>**：<中文描述>。<实现要点 + 文件位置 + 真机验证/没验证>。

### Changed
- **<change name>**：<描述>。<breaking? 标 (breaking)>。

### Removed (breaking)
- **<api name>**：<删除内容>。**Migration**：<迁移路径>。

### Fixed
- **<bug name>**：<根因 + 修法>。
```

bullet 用 `- **` 加粗关键名词**,延续 0.2.6/0.2.7 风格。

### 4b. bump `package.json#version`

```bash
# 直接 sed 或 replace_string_in_file
sed -i '' 's/"version": "0.2.X"/"version": "0.2.Y"/' package.json
```

### 4c. 固化段(SOP §6.1 第 4 步)

```markdown
## [Unreleased]
              ← 空块保留,下笔工作从这里开始

## [X.Y.Z] - $(date +%Y-%m-%d)   ← 新版本块在 [Unreleased] 之下

### Added
...
```

**验证**:
```bash
grep -n "^## \[" CHANGELOG.md
# 期望:每个版本标题恰好 1 次,[Unreleased] 段内无 ## 子标题
```

---

## 步骤 5 — skills drift fix（同一 commit 内）

```bash
node scripts/check-skills-drift.mjs --fix
```

输出:
```
--fix: 已更新 6 个 SKILL.md 的 version → X.Y.Z
```

**预期**:6 个 `skills/abap-cli*/SKILL.md` 的 `metadata.version` 全部 bump。git diff 检查:
```bash
git diff skills/*/SKILL.md | grep -E "^[-+].*version"
```

**重大改进**（0.2.7 → 0.2.8 实施）:6 个 SKILL.md 的改动**进同一个 release commit**,不开独立 commit。这样 `git log` 不需要追溯"skills bump 是何时跟 release commit 分离的"。

---

## 步骤 6 — release commit

```bash
git add CHANGELOG.md package.json skills/*/SKILL.md
git commit -m "chore(release): X.Y.Z

Major themes since X.Y.(Z-1) (N commits; +xxxx / -yyyy):

<主题 1>
- <要点>

<主题 2>
- <要点>

...

Verified locally:
  - npm run verify (tsc + vitest + check-skills-drift) — clean
  - N test files, NNN/NNN tests pass
  - 6 SKILL.md files version-bumped to X.Y.Z in this same commit
    (the skills-drift fix is bundled here, not a follow-up)"
```

**bash 转义注意**:commit message 含 `$USERNAME` / `$USER` 时用 `git commit -m` 没破——bash 不展开 here-doc,只在 `git commit` 后 shell 解析 `$VAR`。但**release commit message 含 `$VAR` 时建议**:
- 用单引号 `git commit -m '...'` 包整段 message
- 或 commit 后用 `git commit --amend -m '...'` 修正

**真实坑**:0.2.8 release commit 第一次写时用 `git commit -m "..."` + bash 双引号 → `$USERNAME` 被展开为 `lei` → 用 `--amend` 改成单引号修正。

**严禁**:
- 把 release commit 拆成多个（CHANGELOG + version bump 独立）
- 把 release commit 与源码 fix 合并
- 用 emoji（除非用户明确要）

---

## 步骤 7 — push + PR

```bash
git push origin dev
gh pr create --base main --head dev --title "release: X.Y.Z" --body ""
```

**为何 title 简写 + body 空**:沿用 PR #17 / #18 惯例,[copilot-instructions.md](../../../copilot-instructions.md) 规则不带 bug/spec 编号。

**为何 PR → main 而不是直接 push main**:所有改动走 dev → PR → main。main 只接受 merge commit + tag。direct push to main 仅限 workflow 文件本身的紧急修复。

---

## 步骤 8 — merge + tag + push tag

```bash
# 1) merge PR
gh pr merge <PR_NUM> --merge --delete-branch=false

# 2) 切 main + pull
git checkout main
git pull --ff-only origin main

# 3) 打 tag + push
git tag -a vX.Y.Z -m "X.Y.Z"
git push origin vX.Y.Z
```

**为何先 merge PR 再切 main**:tag 必须在 main HEAD,且 main HEAD 必须已包含 release commit。若先 tag 再 merge,tag 会指向 release commit 之前的 main。

**为何 `--delete-branch=false`**:dev 持续累计下一笔工作,删了下次又要重建。

**tag push 触发 publish**:Actions `publish-to-npm` workflow 监听 `v*` tag push。

---

## 步骤 9 — 轮询 Actions run + 验 npm

```bash
# 找 run id
gh run list --limit 1

# 同步轮询
gh run watch <RUN_ID>

# 详细 step 看
gh run view <RUN_ID> --json status,conclusion,jobs,steps
```

期望 step 顺序:
1. Set up job
2. Checkout（refs/tags/vX.Y.Z → commit SHA）
3. Setup Node.js (Node 24)
4. Install libsecret for keytar
5. Install dependencies (npm ci)
6. Resolve package version
7. Check if version is already published（404 → not published）
8. Publish to npm
9. Dry-run summary（skipped — not workflow_dispatch）

**预期时间**:~50s（0.2.7 43s,0.2.8 52s）。

**npm propagation 延迟**:Actions success 后立即 `npm view abap-cli@X.Y.Z version` 仍是 404。约 3 分钟后 `latest: X.Y.Z` 才传播。这是 npm registry 设计,不是 bug。

```bash
# 等 3 分钟再验真机
sleep 180 && npm view abap-cli@X.Y.Z version --registry=https://registry.npmjs.org
# 期望:输出 "X.Y.Z"
```

---

## 步骤 10 — smoke + 写 done handoff

```bash
# 本地安装
npm install -g abap-cli@X.Y.Z

# 验版本
abap --version
# 期望:X.Y.Z
```

**写 done handoff**:模板见 [references/handoff-template.md](./handoff-template.md)。

**关键记录**:
- merge commit SHA
- tag → commit 引用
- Actions run id + duration + conclusion
- npm propagation 观察
- smoke test 结果

---

## 错误恢复速查

### tag 打错 / run fail
```bash
# 退 tag（避免再次触发 run）
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z

# 修 → commit → 开新 PR → merge → 重打 tag
```

### publish 报 "already published"
CI 的 "Check if version is already published" step 应该拦住,但若漏过,run 会 fail。处理:
```bash
# 1) 退 tag
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
# 2) npm unpublish(24h 内可撤回)
npm unpublish abap-cli@X.Y.Z --registry=https://registry.npmjs.org
# 3) 重打 tag → push
```

### CHANGELOG 写漏了 commit
**严禁** force-push amend。直接开新 commit 改 CHANGELOG,然后 `chore(changelog): backfill X.Y.Z with missing F-XX`。

### main 上有紧急 hotfix
仅限 workflow 文件本身的 bug。流程:branch off main → fix → 直接 push main(本项目没有 main branch protection,理论上允许)→ tag。

---

## 12 个历史坑（对照检查）

| # | 坑 | 0.2.8 状态 |
|---|---|---|
| 1 | spec 依赖 CI fail | 已修（PR #13） |
| 2 | keytar libsecret | workflow 已装 |
| 3 | 子进程 cwd | `withFakeProject()` |
| 4 | `skipIf` 永远 skip | dist 自动 build |
| 5 | CHANGELOG 重复 | sanity check |
| 6 | release commit 夹带 | 严格只动 8 文件 |
| 7 | PR title 编号 | 简写 + body 空 |
| 8 | tag 落后 main | checkout + pull |
| 9 | prepublishOnly 钩子 | workflow 已 build |
| 10 | merge 默认信息 | `--merge` 不 squash |
| 11 | 镜像源 401 | OIDC 不受影响 |
| 12 | Actions run id | handoff 必记 |

**新增（第 13 个）**:release commit message 含 `$USERNAME` 时 bash 双引号会展开 → 单引号 / `--amend` 修正。