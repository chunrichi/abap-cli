# Contributing to abap-cli

## Development Setup

```bash
git clone <repo-url>
cd abap-cli
npm install
npm run build
```

## Project Structure

- `src/abap_cli/` — TypeScript CLI source code
- `abap/` — ABAP source code for ICF services
- `skills/` — Agent skill prompts (per command)
- `agents/` — Agent workflow prompts (multi-step)
- `docs/` — Project documentation (getting started, commands, architecture, etc.)

## Adding a New CLI Command

1. Create `src/abap_cli/commands/<name>.ts` with a `register<Name>Command` function
2. Register it in `src/abap_cli/index.ts`
3. Add a corresponding skill file in `skills/abap-<name>.md`
4. Document it in `docs/commands.md` and update the README command table

See [docs/development.md](docs/development.md) for the full development guide.

## Pull Requests

- Keep PRs focused on a single change
- Follow existing code conventions
- All CLI commands must support `--json` output mode
