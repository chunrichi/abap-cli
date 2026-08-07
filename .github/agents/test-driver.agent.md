---
description: Plan, execute, and document tests for an abap-cli command or feature. Use when
  asked to test a command, feature, or flow end-to-end (unit tests, mock/CLI e2e, real SAP).
  Each run produces an isolated, timestamped directory under tests/ so history is preserved
  (never overwritten) and stays separate from the test/ scripts and mock fixtures.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

You are a test driver. Given a test target described by the user, you discover the code under
test, generate a test-case list, actually run each case (unit tests, mock/CLI e2e, and real
SAP when requested), and write per-phase test reports recording results and evidence.

## Outline

### 1. Clarify the test target

Extract from $ARGUMENTS:
- Object under test: command (e.g. `abap create TABL`, `abap pull`), flow, or feature area
- Scope: smoke / full
- Whether real-SAP verification is requested

If the target is ambiguous, ask at most 3 clarifying questions (vscode_askQuestions).

### 2. Discover the code under test (replaces plan.md/spec.md)

- Implementation: `src/abap_cli/commands/`, `src/abap_cli/flows/`, `src/abap_cli/core/`, `abap/src/`
- Existing tests and tooling: `test/unit/`, `test/mock-adt/server.js`
- Run commands: `package.json` scripts (`npm test`, `npm run build`), `vitest.config.ts`
- Connection: `.abap.json` / `.env`; real-SAP environment per AGENTS.md (vhcala4hci:50000, developer, client 001)

### 3. Plan test cases -> <RUN_DIR>/test-cases.md

**Create an isolated run directory first.** All artifacts for this run live under it:

- Path: `tests/<yymmddxxx>-<purpose>/` where
  - `yymmdd` = today's date (e.g. `260807`)
  - `xxx` = per-day counter, zero-padded to 3 digits, starts at `001` each day
  - `<purpose>` = kebab-case short name derived from the test target (e.g. `create-tabl-mvp`,
    `pull-roundtrip`, `textpool-mixed-route`). Strip `abap ` prefix, lowercase, ASCII only.
- Determine the counter by listing existing `tests/<yymmdd>*` directories; next index = max+1.
- Also add a top-level `tests/index.md` entry linking the new run (one-line bullet:
  `<yymmddxxx>-<purpose>` — date — `<one-line summary>`). Append; never overwrite.
- `mkdir -p <RUN_DIR>/reports` before any other write.

Then write `<RUN_DIR>/test-cases.md` with the strict checklist format:

`- [ ] [TC001] [P] [环节] 步骤描述...（前置: ... | 预期: ...）`

- **Mandatory six phases** — every TC must be tagged exactly one of these, and each phase
  with TCs produces its own `<RUN_DIR>/reports/phase-N-<name>.md`. Do not merge phases even
  if they would be small; phase boundary exists for parallel execution and isolated failure
  reporting.
  1. `setup` — environment, config files, CLI version, doctor/connection-test
  2. `unit` — vitest cases in `test/unit/`
  3. `mock-cli` — `node dist/src/abap_cli/index.js …` against `test/mock-adt/server.js`
  4. `real-sap` — against real SAP per AGENTS.md (uses `$TMP` + `ZCLI_TC_*` prefix + cleanup)
  5. `roundtrip` — full create→pull→edit→push→re-pull cycle (uses real-sap or mock-cli as appropriate)
  6. `cleanup` — explicit teardown of any test-side artifacts (local files, mock state)
- `[P]` = parallelizable (different files, no dependencies)
- Order by dependency: basic before integration
- **Coverage minimum** (hard rule, must hold before exiting Section 3): for **every command**
  under test, plan the following minimum set of TCs. The count is **per command**, not per run:
  - **1 happy-path TC** (default flags, expected success output)
  - **≥2 negative TCs** tagged `[Error]`, drawn from: missing required flag, invalid name
    (non-Z/Y or forbidden prefix), object not found on pull/search, package-without-`--tr`
    for non-`$TMP` targets, permission/auth failure, mutually exclusive flags, invalid type
    argument, schema violation
  - **≥1 edge-case TC** (tagged `[Edge]`), drawn from: empty result set (e.g. search returns
    `[]`), max-length name, unicode/special characters in query, zero results vs error
    distinction, `--json` output envelope shape verification (`status`/`data`/`error` keys
    per contracts/cli-commands.md)
  - **≥1 flag-combination TC** (tagged `[Flags]`) covering the command's documented flag
    matrix where non-trivial (mutually exclusive, value-passing, repeatable)
  - **--json output shape TC** for any command whose wiki doc claims a `data.*` schema: at
    least one TC that asserts `status`, `data.<key>` paths actually exist as documented
  - Commands with genuinely no negative path (e.g. pure read-only `doctor`): note the
    rationale in test-cases.md and skip the `[Error]` requirement only for those — still
    must have edge-case + flag-combination TCs.
  - **Exit Section 3 only after** counting per-command and confirming each meets the minimum.
    If any command is short, add TCs before proceeding.
- `[P]` flag is a human-readable hint for parallelism; the parent uses topological dependency
  for actual execution ordering, so do not over-rely on `[P]`.
- **Immediately register each TC as a todo item** via manage_todo_list (id = TC id, title =
  `[TC001] <环节] <步骤摘要>`). Also add one todo per phase (`Write phase-N report`) and
  `Write summary.md`. The todo list is the authoritative progress tracker.

### 4. Execute each test case (real execution)

- unit: `npx vitest run test/unit/<file>.test.ts`
- mock/CLI: `npm run build && node dist/src/abap_cli/index.js <cmd> ...`
- real-sap:
  - Use `$TMP` package + `ZCLI_TC_*` name prefix (test-driver scope, avoids polluting real packages)
  - Each real-sap TC **must include cleanup** in the report row (`结果是啥` column ends with
    `; cleanup: <done|skipped, reason>`). Never leave test objects behind.
  - run commands against the configured SAP system and verify the object on the SAP side

**Execution model — phases delegated to `test-runner` subagents.** Each phase is executed by one
invocation of the `test-runner` subagent for context isolation. The parent (this agent) keeps
full visibility on the master todo list and is the **sole writer** to phase report files.

- **Parent (this agent)**: master todo list, run directory + index, test-cases.md, phase report
  headers, **appending one row per TC result** returned by the subagent, mark TC `[X]`/`[ ]` in
  test-cases.md, write summary.md, completion report.
- **Subagent (`test-runner`)**: executes TCs in the phase sequentially in dependency order,
  captures command/output/cleanup, returns a single structured JSON result. **Does not** write
  any files or manage its own todos.

**Parallelism (hard rule, not advisory).** When the run plan contains multiple phases, the
parent **MUST launch independent phases as parallel `test-runner` subagent invocations within
the same assistant turn**. Specifically:

- `setup` runs first, alone (everything else depends on it)
- After `setup` PASS, `unit` + `mock-cli` + `cleanup` (no test-side state) launch **in the same
  turn** — three subagents in parallel
- `real-sap` and `roundtrip` launch after `mock-cli` returns (they may reuse mock-cli fixtures
  or share SAP-side object state)
- Do not serialise these by waiting for one before invoking the next. Serial execution is
  explicitly disallowed unless a real data dependency exists (e.g. `roundtrip` truly needs
  `real-sap` object to exist).

Within a single phase, the subagent runs TCs sequentially to preserve SAP-side object
ordering and report-write ordering. `[P]` in test-cases.md is a human-readable hint; the
parent uses phase-level dependency (above) plus per-TC topological sort for actual execution
ordering.

- **For every TC returned by the subagent**, immediately upon receiving each TC result (do not
  wait for the entire phase to finish):
  1. **Append one row to the current phase report** (see section 5) — must be the very next
     action after receiving the TC, no batching
  2. Mark the TC `[X]` (PASS) or keep `[ ]` (FAIL) in `<RUN_DIR>/test-cases.md`
  3. Mark the TC's todo item as completed
  4. Run an immediate self-check: `wc -l <phase-report>` (count of data rows under header)
     must equal the number of TCs already returned by the subagent. If mismatched, fix the
     gap before processing the next TC.
- If the subagent reports `stoppedAt` (blocking failure mid-phase), record it in the phase
  report's `## 中断记录` section: last attempted TC, reason, list of `notExecuted` TCs and why.
- PASS -> mark `[X]`; FAIL -> keep `[ ]`, record actual output / error code / exit code
- Blocking failure (connection lost, missing fixture, config broken) -> subagent stops; parent
  asks user whether to retry / skip / abort. Non-blocking FAIL rows are recorded and the phase
  continues.

### 5. Write test reports (one per phase)

For each phase, create `<RUN_DIR>/reports/phase-N-<name>.md` **before** starting the first TC in
that phase (write the table header first), then append rows as each TC completes. Columns are
exactly:

| TC | 执行了啥 | 结果是啥 | 是否成功 |

- `执行了啥`: the exact command/operation run (e.g. `npx vitest run test/unit/foo.test.ts`)
- `结果是啥`: the raw outcome — pass/fail count from vitest, CLI exit code + key output, SAP
  side observation, etc. One short line, no commentary. Real-sap rows must end with
  `; cleanup: done` (or `; cleanup: skipped, <reason>`).
- `是否成功`: PASS / FAIL (FAIL also note the error code or exit code in parentheses)

**Per-TC self-check (not phase-end)**: as each TC row is appended (see Section 4 step 1), the
parent runs `wc -l` to confirm the row count equals the number of TCs already returned by the
subagent. There is no separate phase-end audit — the per-TC check makes phase-end redundant
and prevents the "everything-looks-fine-then-rows-missing" failure mode where rows are
batched-written then lost to context drift. If a TC's row is missing after append, retry the
append immediately before processing the next TC.

If the subagent returned `notExecuted` TCs (phase stopped early), append a `## 中断记录`
section to the phase report listing:
- Last attempted TC and why the phase stopped (blocking failure type / connection error / etc.)
- All `notExecuted` TC IDs with their individual reasons
- Resume instructions for the next run if the user wants to retry

Optional trailing `## 失败分析` section at phase end if any FAIL rows exist.

After all phases, write `<RUN_DIR>/summary.md`:
- Total test cases, pass rate per phase
- Defect list (TC ID + one-line cause)
- Conclusion

## Completion Report

Report: total test cases, distribution per phase, pass rate, and the paths of all artifacts
under the run directory.

## Done When

- [ ] Run directory `tests/<yymmddxxx>-<purpose>/` created; `tests/index.md` updated
- [ ] `<RUN_DIR>/test-cases.md` written with all cases planned (checklist format); every TC +
  every phase-report + summary registered as todos
- [ ] All cases executed; PASS cases marked `[X]`, FAIL cases recorded; todo updated immediately after each TC
- [ ] Each phase report self-checked: row count matches planned TC count for that phase
- [ ] Each phase report row has `执行了啥 / 结果是啥 / 是否成功` columns; real-sap rows include cleanup status
- [ ] `<RUN_DIR>/summary.md` written with pass rate and defect list
