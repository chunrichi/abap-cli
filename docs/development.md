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
8. **`npm run docs:check`** — 生成物（`docs/commands.md`、skill quick refs、命令索引）与命令 schema 一致（已并入 `npm run verify`）

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

命令参考与 skill 速查不是手写的，由命令 schema（`src/abap_cli/flows/setup/command-schemas.ts` 与各命令的 `SCHEMA` 常量）生成：

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
├── index.ts              # commander entry, lazy-registers all commands
├── top-error.ts          # top-level commander error routing (--json safe)
├── clients/              # AdtClientWrapper, ICF client, probe
├── commands/             # one file per command (init / profile / pull / push / check / create / search / status / diff / inspect / activate / run / select / where-used / tcode / transport / doctor / mime / session / types …)
├── config/               # project + user config, keychain (secrets.ts), profile export/import, validation
├── core/                 # lazy registration, polyfill, object/transport resolution, limits
├── dictionary/           # DDIC + HTTP domain logic (ddic-json.ts, http-json.ts, tabl-artifact.ts)
├── clients/icf-version.ts # ICF service version + deployment check
├── formats/              # file format + resolver + pull strategies + object-parts
├── output/               # unified JSON output, error codes, meta, check-issue types — see output/README.md
└── flows/                # init (bind/modify/inspect/clear), profile, create (+ schema/types), pull, push (object/fugr/textpool), run, select, tcode, where-used, status, diff, inspect, doctor, atc
```

## Adding a New Command

1. Create `src/abap_cli/commands/<name>.ts` exporting `register<Name>Command(program: Command)`
2. Register it lazily in `src/abap_cli/index.ts`: add a `COMMAND_SPECS` entry (command `name`, root-help `description`, and a `load` that dynamically `import()`s the module — see `src/abap_cli/core/lazy.ts`). The stub's description must match the one the module registers.
3. Use `output/json.ts` (`printResult` / `printError`) so `--json` behaves consistently
4. 在对应的领域 skill（`skills/abap-cli-<领域>/`）里补该命令的 references 条目，并更新 `metadata.commands`
5. Document it in [Commands](commands.md) and update the README command table

### Command Pattern

Follow the existing pattern (e.g. `commands/transport.ts`):

```ts
import { Command } from 'commander';
import { AdtClientWrapper } from '../clients/adt-client.js';
import { printError, printResult } from '../output/json.js';

export function registerMyCommand(program: Command): void {
  program
    .command('mycmd')
    .description('...')
    .action(async (opts, cmd) => {
      const json = jsonFrom(cmd); // walk to the root for the global --json flag
      try {
        await runMyCommand(opts, json);
      } catch (error) {
        printError(json, error);
      }
    });
}
```

Use the `jsonFrom(cmd)` helper (walk `cmd.parent` to the root) rather than `cmd.parent?.opts()?.json` when the command is nested under a subcommand.

## Conventions

- **Reuse, don't duplicate** — config (`loadConfig`), transport resolution (`resolveTransport`), and output helpers are shared; do not re-implement them
- **All commands support `--json`**（见 `AGENTS.md` 的验证与架构约定）
- **Credentials never in output** — passwords only via keychain / `--password` / TTY prompt
- **SAP-side code via Dogfooding** — develop `abap/` ICF code using the CLI's own pull → edit → push loop (no Eclipse/SAP GUI)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution workflow and PR guidance. See [SUPPORT.md](../SUPPORT.md) for support and bug reporting.
