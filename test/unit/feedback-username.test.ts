/**
 * F-06 — `abap feedback` must work on macOS/Linux out of the box.
 *
 * `--username` is documented as optional, but the resolver read only `USERNAME`
 * — a Windows/PowerShell variable that does not exist on POSIX — and the error
 * guidance was PowerShell-only, so every non-Windows user hit
 * `CONFIG_ERROR: The USERNAME environment variable is required for feedback.`
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userInfoThrows: { value: true } }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    userInfo: () => {
      if (h.userInfoThrows.value) throw new Error('no user info in this environment');
      return { username: 'os-user' };
    },
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: () => ({ status: 1, stdout: '', stderr: '' }) };
});

import { normalizeFeedback } from '../../src/abap_cli/flows/feedback-flow.js';
import { CliError } from '../../src/abap_cli/output/json.js';

const base = { featureKey: 'abap.cli', title: 't', description: 'd' };
const savedEnv = { USERNAME: process.env.USERNAME, USER: process.env.USER };

beforeEach(() => {
  h.userInfoThrows.value = true;
  delete process.env.USERNAME;
  delete process.env.USER;
});

afterEach(() => {
  if (savedEnv.USERNAME === undefined) delete process.env.USERNAME;
  else process.env.USERNAME = savedEnv.USERNAME;
  if (savedEnv.USER === undefined) delete process.env.USER;
  else process.env.USER = savedEnv.USER;
});

describe('feedback username resolution (F-06)', () => {
  it('prefers the explicit --username', () => {
    process.env.USERNAME = 'from-env';
    expect(normalizeFeedback({ ...base, username: 'explicit' }).payload.username).toBe('explicit');
  });

  it('uses $USERNAME when set (Windows)', () => {
    process.env.USERNAME = 'win-user';
    expect(normalizeFeedback(base).payload.username).toBe('win-user');
  });

  it('falls back to $USER on POSIX', () => {
    process.env.USER = 'posix-user';
    expect(normalizeFeedback(base).payload.username).toBe('posix-user');
  });

  it('falls back to os.userInfo().username', () => {
    h.userInfoThrows.value = false;
    expect(normalizeFeedback(base).payload.username).toBe('os-user');
  });

  it('gives platform-appropriate guidance (never PowerShell-only) when nothing is found', () => {
    let caught: CliError | undefined;
    try {
      normalizeFeedback(base);
    } catch (error) {
      caught = error as CliError;
    }
    expect(caught?.code).toBe('CONFIG_ERROR');
    const steps = (caught?.nextSteps ?? []).join('\n');
    const example = caught?.example ?? '';
    if (process.platform === 'win32') {
      expect(steps).toContain('$env:USERNAME');
    } else {
      expect(steps).toContain('USER');
      expect(steps).not.toContain('PowerShell');
      expect(example).not.toContain('$env:USERNAME');
      expect(example).toContain('--username');
    }
    expect(caught?.details?.tried).toEqual(['USERNAME', 'USER', 'os.userInfo().username', 'git config user.name']);
  });
});
