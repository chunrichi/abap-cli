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
npm run build        # TypeScript compile check
npm test             # unit tests (vitest)
npm run verify       # build + unit tests
node dist/src/abap_cli/index.js --help
```

Verification is done via:

1. **`npm run build`** — TypeScript compile gate
2. **`npm test` (vitest)** — unit tests in `test/unit/` covering command option contracts, error codes, and config handling
3. **Local mock ADT server** — offline end-to-end checks (no SAP needed)
4. **Real SAP integration** — protocol-level verification against a live system

## Local Mock ADT Server

`test/mock-adt/server.js` implements a subset of the ADT REST API for offline verification:

- login (`compatibility/graph`), repository search, object structure, source GET/PUT
- lock/unlock, content-based checkruns, activation
- object creation (createObject POST)
- transport: `GET /sap/bc/adt/cts/transportrequests` and `POST /sap/bc/adt/cts/transports`

```bash
node test/mock-adt/server.js [port]        # default 8080
MOCK_NO_TRANSPORTS=1 node test/mock-adt/server.js  # simulate no open transports
```

Point a test workspace at it:

```bash
mkdir -p tmp/test && cd tmp/test
SAP_PASSWORD=mockpw abap init --system mock --url http://localhost:8080 --client 100 --username MOCKUSER --password mockpw
```

Then run the workflows from [Getting Started](getting-started.md) against the mock.

## Project Structure

```
src/abap_cli/
├── index.ts              # commander entry, lazy-registers all commands
├── clients/              # AdtClientWrapper, ICF client, probe
├── commands/             # one file per command (incl. activate, deploy, inspect)
├── config/               # project + user config
├── crypto/secrets.ts     # keychain
├── icf/                  # ICF service version + deployment check (service-version.ts)
├── formats/              # file format + resolver + pull strategies
├── output/               # unified JSON output, error codes, meta
└── sync/                 # resolve, transport, push-flow, deploy-flow, status, doctor-checks
```

## Adding a New Command

1. Create `src/abap_cli/commands/<name>.ts` exporting `register<Name>Command(program: Command)`
2. Register it lazily in `src/abap_cli/index.ts`: add a `COMMAND_SPECS` entry (command `name`, root-help `description`, and a `load` that dynamically `import()`s the module — see `src/abap_cli/commands/lazy.ts`). The stub's description must match the one the module registers.
3. Use `output/json.ts` (`printResult` / `printError`) so `--json` behaves consistently
4. Add a corresponding skill prompt in `skills/abap-<name>.md` (Agent layer)
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
- **All commands support `--json`** (Constitution Quality Gate)
- **Credentials never in output** — passwords only via keychain / `SAP_PASSWORD`
- **SAP-side code via Dogfooding** — develop `abap/` ICF code using the CLI's own pull → edit → push loop (no Eclipse/SAP GUI)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution workflow and PR guidance. See [SUPPORT.md](../SUPPORT.md) for support and bug reporting.
