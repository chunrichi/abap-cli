# Contributing to abap-cli

## Setup

```bash
git clone https://github.com/chunrichi/abap-cli.git
cd abap-cli
npm install
bash scripts/setup-hooks.sh   # enables .githooks/pre-push (runs verify)
npm run build
```

Full development guide: [docs/development.md](docs/development.md).

## Repository layout

- `src/abap_cli/` — TypeScript CLI. `registry/commands.ts` is the single command list.
- `abap/` — ABAP ICF service, deployed by `abap deploy`.
- `skills/`, `agents/` — agent context shipped in the npm package.
- `docs/` — user-facing documentation; `wiki/` — maintainer knowledge base.
- `test/` — unit and mock-ADT integration tests; `tests/` — local real-SAP evidence (gitignored).
- `scripts/` — build, docs generation, drift checks, hooks.

## Verify before pushing

```bash
npm run verify   # build + vitest + docs:check + skills drift
```

CI runs the same command on every push to `main` and every PR; the pre-push hook
is only a local convenience.

## Adding or changing a command

1. Implement `src/abap_cli/commands/<name>.ts` (`register<Name>Command` + `SCHEMA`).
2. Register it in `src/abap_cli/registry/commands.ts`.
3. Update the owning skill's `metadata.commands` in `skills/*/SKILL.md`.
4. Add `wiki/commands/<name>.md` (hand-written narrative; the generator only
   creates a stub when the page is missing).
5. Run `npm run build && npm run docs:build` and commit the generated files
   (`docs/commands.md`, `skills/*/references/commands-quick.md`,
   `wiki/commands/index.md`, README command table). Never edit them by hand.
6. Add tests under `test/unit/`; real-SAP runs go to `tests/` and stay out of git.

## Pull requests

- One logical change per PR; the PR title becomes the squash commit subject.
- Use Conventional Commits (`feat(cli): …`, `fix(activation): …`); do **not**
  put spec/task/PR numbers in commits, PR descriptions, code comments or wiki.
- Breaking changes: add a `Removed (breaking)`/`Changed` entry with a
  **Migration** note to `CHANGELOG.md`, and write `BREAKING CHANGE:` in the
  commit footer.
- `npm run verify` must be green; CI enforces it.
