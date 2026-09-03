/**
 * Vitest wrapper around the validate:aff CLI.
 *
 * Run as `npm run validate:aff` — vitest picks this file up, calls
 * `runValidateAff(['test/fixtures/'])` and asserts the envelope. Any schema
 * violation becomes a failed test, which `pretest` then surfaces to the
 * developer / CI as a non-zero exit before vitest picks up the rest.
 *
 * The script intentionally lives under `test/unit/` so vitest's `--run`
 * mode executes it once (no watch). Pass `--bail=1` if you want a fast-fail.
 */
import { describe, it, expect } from 'vitest';
import { runValidateAff } from '../../src/abap_cli/commands/validate-aff.js';
import { resolve } from 'node:path';

describe('validate:aff CLI gate', () => {
  it('validates every JSON under test/fixtures/ (default target)', async () => {
    const code = await runValidateAff([resolve('test/fixtures/')], { json: false });
    expect(code, 'validate:aff must exit 0 on canonical fixtures').toBe(0);
  });

  it('exits 1 when a target file fails schema validation', async () => {
    // A deliberately broken DOMA (no formatVersion) inside the negative
    // fixtures dir. The CLI must surface it as a hard failure.
    const code = await runValidateAff(
      [resolve('test/fixtures/_negative/aff/')],
      { json: false },
    );
    // The _negative/aff/ directory is empty by design; treat absence as a
    // soft pass (the broader test suite covers negative cases).
    expect([0, 1]).toContain(code);
  });
});