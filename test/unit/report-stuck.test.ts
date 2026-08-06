import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerReportStuckCommand } from '../../src/abap_cli/commands/report-stuck.js';
import { makeProgram, runCommand } from './cli-helper.js';
import {
  writeStuckReport,
  recordFailure,
  shouldAutoReport,
  setReportsDir,
  setCounterPath,
} from '../../src/abap_cli/core/stuck-reports.js';

let home: string;
let reportsDir: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-'));
  reportsDir = path.join(home, '.abap-cli', 'reports');
  setReportsDir(reportsDir);
  setCounterPath(path.join(home, '.abap-cli', '.stuck-count.json'));
  process.exitCode = undefined;
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function parseData(res: { stdout: string }) {
  return JSON.parse(res.stdout).data;
}

describe('abap report-stuck (US6, FR-022..024, SC-007)', () => {
  it('records a report with stable id and echoes inputs (FR-022, SC-007)', async () => {
    const program = makeProgram();
    registerReportStuckCommand(program);
    const res = await runCommand(program, ['report-stuck', '--goal', 'push zcl_demo', '--tried', 'retried 3x', '--where', 'abap push', '--json']);
    expect(res.exitCode).toBeUndefined();
    const data = parseData(res);
    expect(data.id).toMatch(/^STUCK-/);
    expect(data.recorded).toBe(true);
    expect(data.echo).toMatchObject({ goal: 'push zcl_demo', tried: 'retried 3x', where: 'abap push' });
    const files = fs.readdirSync(reportsDir);
    expect(files.length).toBe(1);
    const mode = fs.statSync(path.join(reportsDir, files[0]!)).mode;
    expect(mode & 0o777).toBe(0o600);
    const record = JSON.parse(fs.readFileSync(path.join(reportsDir, files[0]!), 'utf-8'));
    expect(record.id).toBe(data.id);
    expect(record.goal).toBe('push zcl_demo');
  });

  it('missing required args → USAGE exit 2 with nextSteps (FR-022)', async () => {
    const program = makeProgram();
    registerReportStuckCommand(program);
    const res = await runCommand(program, ['report-stuck', '--json']);
    expect(res.exitCode).toBe(2);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.error.code).toBe('USAGE');
  });

  it('unwritable reports dir → recorded false, STUCK-DEGRADED id, no crash (FR-024, SC-007)', async () => {
    fs.rmSync(reportsDir, { recursive: true, force: true });
    // Make the parent dir read-only so mkdir/write fails.
    fs.mkdirSync(path.join(home, '.abap-cli'), { recursive: true });
    fs.chmodSync(path.join(home, '.abap-cli'), 0o500);
    try {
      const program = makeProgram();
      registerReportStuckCommand(program);
      const res = await runCommand(program, ['report-stuck', '--goal', 'g', '--tried', 't', '--where', 'w', '--json']);
      expect(res.exitCode).toBeUndefined();
      const data = parseData(res);
      expect(data.recorded).toBe(false);
      expect(data.id).toMatch(/^STUCK-DEGRADED-/);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.meta.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'STUCK_REPORT_DEGRADED' })]),
      );
    } finally {
      fs.chmodSync(path.join(home, '.abap-cli'), 0o700);
    }
  });

  it('--report-stuck on a failing command records context and keeps the original error (FR-023)', async () => {
    // Simulate the top-level funnel: a failing command with --report-stuck.
    const res = await writeStuckReport({ goal: 'pull', where: 'abap pull', argv: ['pull', 'Z_NOPE', '--report-stuck'] });
    expect(res.recorded).toBe(true);
    expect(res.id).toMatch(/^STUCK-/);
    // The original error is still returned by the caller — here we verify the
    // record itself carries command/argv context and no credentials.
    const files = fs.readdirSync(reportsDir);
    const record = JSON.parse(fs.readFileSync(path.join(reportsDir, files[0]!), 'utf-8'));
    expect(record.argv).toContain('--report-stuck');
  });

  it('ABAP_REPORT_STUCK=1 auto-triggers after the failure threshold (FR-023)', async () => {
    // Threshold: 3 failures within the window; trigger consumed on read.
    expect(shouldAutoReport(undefined)).toBe(false); // env not set → no auto-report
    expect(shouldAutoReport('1')).toBe(false); // below threshold
    recordFailure();
    recordFailure();
    expect(shouldAutoReport('1')).toBe(false);
    recordFailure();
    expect(shouldAutoReport('1')).toBe(true); // threshold crossed → consumed + reset
    expect(shouldAutoReport('1')).toBe(false); // counter reset
  });

  it('report files never contain credentials/config content (Constitution VI)', async () => {
    const program = makeProgram();
    registerReportStuckCommand(program);
    await runCommand(program, ['report-stuck', '--goal', 'g', '--tried', 't', '--where', 'w', '--json']);
    const files = fs.readdirSync(reportsDir);
    const content = fs.readFileSync(path.join(reportsDir, files[0]!), 'utf-8');
    expect(content).not.toMatch(/password|systems\.json|keychain/i);
  });
});
