# Contributing to abap-vibe

## Development Setup

```bash
git clone <repo-url>
cd vibe_with_abap
npm install
npm run build
```

## Project Structure

- `src/abap_cli/` — TypeScript CLI source code
- `abap/` — ABAP source code for ICF services
- `skills/` — Agent skill prompts (per command)
- `agents/` — Agent workflow prompts (multi-step)

## Adding a New CLI Command

1. Create `src/abap_cli/commands/<name>.ts` with a `register<Name>Command` function
2. Register it in `src/abap_cli/index.ts`
3. Add a corresponding skill file in `skills/abap-<name>.md`

## Pull Requests

- Keep PRs focused on a single change
- Follow existing code conventions
- All CLI commands must support `--json` output mode
