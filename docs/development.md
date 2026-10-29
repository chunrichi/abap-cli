# Development

Guidance for building, testing, and extending abap-cli.

## Setup

```bash
git clone <repo-url>
cd abap-cli
npm install
npm run build        # tsc → dist/
```

## Build & Verify

```bash
npm run build            # TypeScript compile check
npm test                 # unit tests (vitest, test/unit/)
npm run test:integration # integration tests (vitest, test/integration/; needs build)
npm run verify           # build + unit + integration + docs:check + skills 漂移检查
node dist/index.js --help
```

Verification is done via:

1. **`npm run build`** — TypeScript compile gate
2. **`npm test` (vitest)** — unit tests in `test/unit/` covering command option contracts, error codes, output envelope, config handling, and SAP wire mappings
3. **`npm run test:integration` (vitest)** — process-level tests in `test/integration/` that spawn the built CLI (`dist/index.js`) or drive the mock ADT server over real HTTP; run `npm run build` first
4. **`output-contract-audit.test.ts`** — automated check that all CLI errors carry the correct category/exit-code mapping and that every `--json` envelope has a stable `meta` block
5. **`skill-bundle.test.ts`** — automated check that the shipped skill prompts cover every CLI command and respect frontmatter/path/length constraints
6. **Local mock ADT server** — offline end-to-end checks (no SAP needed)
7. **Real SAP integration** — protocol-level verification against a live system (`tests/<run-id>-*` directories)
8. **`npm run docs:check`** — 生成物（`docs/commands.md`、skill quick refs、命令索引）与命令 schema 一致，并跑 `scripts/check-docs.mjs`：wiki 命令页 frontmatter / 章节契约、相对链接死链、命令 `--help` 选项 ⊆ `--schema` 契约（已并入 `npm run verify`）

## Test Layout

```
test/
├── unit/                  # pure in-process tests: no dist/, no real HTTP
│   ├── schema-compliance/
│   └── session-reuse/
├── integration/           # needs the built CLI and/or the mock ADT server
│   ├── mock-adt/
│   │   └── server.js
│   ├── exit-codes-process.test.ts
│   ├── json-serialization.test.ts
│   ├── lazy-commands-cli.test.ts
│   ├── mock-activate-doctor-parity.test.ts
│   └── select-safety.test.ts
├── fixtures/
└── setup.ts
```

- `npm test` is the fast feedback loop and must pass on a clean checkout **without** running `npm run build`.
- `npm run test:integration` exercises process boundaries: it spawns `dist/index.js` and/or starts `test/integration/mock-adt/server.js` on localhost. Build-dependent tests skip themselves when `dist/index.js` is missing, so build first when running the suite standalone.
- Integration tests run with a hermetic `fs.mkdtemp` HOME and workspace: they never read or write the checkout's `.abap.json`, `src/`, or the developer's `~/.abap-cli`.
- `npm run test:coverage` reports unit coverage only.

## 文档生成

命令参考与 skill 速查不是手写的，由各命令模块自己的 schema 常量（`src/abap_cli/commands/<cmd>.ts#SCHEMA`；共享信封字段取 `commands/schema-helpers.ts`）生成：

```bash
npm run build        # 先生成 dist（生成器从编译产物读取 schema）
npm run docs:build   # 写 docs/commands.md、skills/*/references/commands-quick.md、命令索引与 README 命令表
npm run docs:check   # 只校验不写；已并入 npm run verify，CI / 发布闸门都会跑
```

**生成文件禁止手改**：改命令 schema 后重新生成并把生成物一起提交；手改会在下一次 `npm run docs:check` 报漂移。

## Local Mock ADT Server

`test/integration/mock-adt/server.js` implements a subset of the ADT REST API for offline verification:

- login (`compatibility/graph`), repository search, object structure, source GET/PUT
- lock/unlock, content-based checkruns, activation
- object creation (createObject POST)
- transport: `GET /sap/bc/adt/cts/transportrequests` and `POST /sap/bc/adt/cts/transports`

```bash
node test/integration/mock-adt/server.js [port]        # default 8080
MOCK_NO_TRANSPORTS=1 node test/integration/mock-adt/server.js  # simulate no open transports
```

Point a test workspace at it:

```bash
mkdir -p tmp/test && cd tmp/test
abap init --profile mock --url http://localhost:8080 --client 100 --username MOCKUSER --password mockpw --yes
```

Then run the workflows from [Getting Started](getting-started.md) against the mock.

## Project Structure

```
src/abap_cli/
├── index.ts              # commander entry: global options + lifecycle hooks
├── top-error.ts          # top-level commander error routing (--json safe)
├── registry/             # commands.ts (single command list) + lazy.ts (lazy command stubs)
├── commands/             # one file per command — thin: commander declaration + SCHEMA + print
├── flows/                # business logic (edit / setup / search / data / mime / core)
├── formats/              # AFF file resolver + pull strategies + artifact contract; ddic/{types,io,wire,validate,examples}
├── types/                # TYPE_REGISTRY (object-type metadata single source of truth)
├── clients/              # AdtClientWrapper, ICF client + version check, probe
├── config/               # project + user config, keychain (secrets.ts), profile export/import, validation
├── auth/ session/        # auth model + strategies; session reuse / cookie policy
├── core/                 # cross-layer utilities: resolve/transport, limits, path output, confirmation
├── aff/ adc/             # AFF schema validation; ADT Deployment Channel (probe + ICF register)
├── schema/               # vendored abap-file-format JSON schemas
└── output/               # unified JSON output, error codes, meta, check-issue types — see output/README.md
```

## Adding a New Command

1. Put the business logic in `src/abap_cli/flows/<area>/` and return `{ data, human }` (throw `CliError` on failures). The command layer must not import `clients/` directly.
2. Create `src/abap_cli/commands/<name>.ts` exporting `register<Name>Command(program: Command)`: commander declaration + that command's own `SCHEMA` + `printResult`/`printError`. Each command module is the only owner of its schema — there is no central schema table.
3. Register it in `src/abap_cli/registry/commands.ts`: add a `COMMAND_SPECS` entry (command `name`, root-help `description`, `scope`, and a `load` that dynamically `import()`s the module). `registry/lazy.ts` turns each entry into a lazy stub; the stub's description must match the one the module registers.
4. 在对应的领域 skill（`skills/abap-cli-<领域>/`）里补该命令的 references 条目，并更新 `metadata.commands`
5. 运行 `npm run build && npm run docs:build` 重新生成 `docs/commands.md`、skills quick refs 与 wiki 命令索引 stub；手写 `wiki/commands/<cmd>.md` 叙述页并按 okf 契约补章节；最后 `npm run docs:check`（含 `scripts/check-docs.mjs` 的 wiki/死链/schema 漂移检查）
6. Add coverage under `test/unit/`（纯单测）或 `test/integration/`（需构建产物 / mock-ADT）

### Command Pattern

Follow the existing pattern (e.g. `commands/status.ts` — declaration + print only):

```ts
import { Command } from 'commander';
import { printError, printResult, printSchema, jsonFromCommand, type CommandSchema } from '../output/json.js';
import { baseSchema, schemaOption } from './schema-helpers.js';
import { runMyFlow, type MyRunOptions } from '../flows/<area>/my-flow.js';

// This command's machine contract — the only copy of it in the codebase.
export const SCHEMA: CommandSchema = {
  ...baseSchema('mycmd', 'One-line command description.', 'abap mycmd [target] [options]', 'sap'),
  arguments: [{ name: 'target', type: 'string', required: false, description: '...' }],
  options: [
    { name: '--limit', type: 'int', valuePlaceholder: '<n>', default: 20, description: '...' },
    schemaOption(),
  ],
  examples: [{ description: '...', command: 'abap mycmd ZTARGET --limit 50' }],
};

export function registerMyCommand(program: Command): void {
  program
    .command('mycmd [target]')
    .description('...')
    .option('--limit <n>', '...')
    .option('--schema', 'Print the command parameter schema as JSON and exit (no SAP call)')
    .action(async (target: string | undefined, opts: MyRunOptions, cmd) => {
      const mode = jsonFromCommand(cmd); // resolves the global --json / --pretty-json flags
      if (cmd.optsWithGlobals().schema) {
        printSchema(SCHEMA, mode);
        return;
      }
      try {
        const result = await runMyFlow(target, opts);
        printResult(mode, result.data, result.human);
      } catch (error: unknown) {
        printError(mode, error);
      }
    });
}
```

`jsonFromCommand(cmd)` resolves the global output flags; the command itself only declares its own options and prints the flow's `{ data, human }`.

## Delivery Workflow

本仓库的分支 / PR / commit / 交接纪律。本机完整版见本地技能 `.agents/skills/repo-workflow/SKILL.md`（`.agents/` 为本地开发资产、不入库）；干净克隆按本节执行。

- **一个 PR 一个交付单元**：短期分支 `feat|fix|refactor|docs|chore/<slug>`；PR 标题 = squash 后的 commit subject；合并即删分支。禁止直接 push main（ruleset 会拒）；分支落后 main 时用 `gh pr update-branch <pr>`（或本地 rebase）后再合并；required check `verify` 必须绿。
- **Commit 消息**：Conventional Commits；subject 英文祈使句 ≤72 字符；body 用纯文本段落写 why / 影响面 / 验证（**不要**把 `## Why` / `## What` / `## Verification` 这类 PR 模板标题写进 commit body）；不写任务/spec/bug 编号（GitHub squash 自动追加的 `(#N)` 是平台行为，不要手动再写）；`Co-authored-by` / `Signed-off-by` 只用于真实协同，不要给自己伪造 trailer。breaking 用 `BREAKING CHANGE:` footer + `CHANGELOG.md` 的 `Removed (breaking)` + Migration。
- **验证闸门**：源码/测试改动跑 `npm run verify`；命令 schema/命令面改动先 `npm run build && npm run docs:build` 并提交生成物；docs/wiki/脚本改动跑 `npm run docs:check`；`abap/**` / ICF 改动必须在 A4H 在线时走 `abap-testing` skill 的六阶段真机回归，离线就明确写「未跑真机」。
- **文档同步**：结构性改动（新增/删除模块、契约或流程变化）必须同步 `docs/architecture.md`、相关 `wiki/design-decisions/00X-*.md`（推进/关闭某决策时更新「当前代价 / 后果」，删掉过时的「下一步」）、`docs/development.md` 与 `wiki/commands/`。只改 `src/` + `test/` 会让设计决策过期。
- **会话交接**：结束前更新 `tmp/handoff/YYYYMMDD-HHMM-<status>-<topic>.md`，保证 HEAD hash、已完成、下一步、事实快照（npm 锁定期 / A4H / CI）互相一致，并附可直接粘贴的第一条命令。
- **依赖升级**：patch/minor 以 `verify` 绿为准；major 单独 PR，失败则关闭并留下可复现证据（失败测试 + 错误信息），不要强行合并。
- **交付前自检**：分支命名 + `git status` 干净；`verify` 绿；生成物已重建并提交；架构 / 设计决策 / 交接文档已同步；commit 格式合规；PR CI 绿后 squash merge。

## Conventions

- **Reuse, don't duplicate** — config (`loadConfig`), transport resolution (`resolveTransport`), and output helpers are shared; do not re-implement them
- **All commands support `--json`**（见 `AGENTS.md` 的验证与架构约定）
- **Credentials never in output** — passwords only via keychain / `--password` / TTY prompt
- **SAP-side code via Dogfooding** — develop `abap/` ICF code using the CLI's own pull → edit → push loop (no Eclipse/SAP GUI)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution workflow and PR guidance. See [SUPPORT.md](../SUPPORT.md) for support and bug reporting.
