import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { verifyLockfile, extensionsLockPath, type ExtensionsLock } from '../../src/abap_cli/extensions/lockfile.js';

describe('P3.2 verifyLockfile', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p32-'));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('ok=false when no lockfile exists', async () => {
    const result = await verifyLockfile(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.total).toBe(0);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]?.packageName).toBe('(lockfile)');
  });

  it('ok=true when lockfile is empty', async () => {
    const lock: ExtensionsLock = { schemaVersion: 1, lastResolved: new Date().toISOString(), entries: [] };
    await fs.writeFile(extensionsLockPath(tmpDir), JSON.stringify(lock), 'utf-8');
    const result = await verifyLockfile(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(0);
  });

  it('ok=false with INTEGRITY_UNRESOLVABLE for missing resolved path', async () => {
    const lock: ExtensionsLock = {
      schemaVersion: 1,
      lastResolved: new Date().toISOString(),
      entries: [{ packageName: 'no-such-pkg', integrity: 'sha512-abc', resolved: '/nope' }],
    };
    await fs.writeFile(extensionsLockPath(tmpDir), JSON.stringify(lock), 'utf-8');
    const result = await verifyLockfile(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.total).toBe(1);
    if (!result.mismatches[0]?.result.ok) {
      expect(result.mismatches[0].result.reason).toBe('INTEGRITY_UNRESOLVABLE');
    }
  });

  it('lockfilePath ends with extensions.lock.json', async () => {
    const result = await verifyLockfile(tmpDir);
    expect(result.lockfilePath.endsWith('extensions.lock.json')).toBe(true);
  });

  it('ok=false when lockfile is malformed JSON', async () => {
    await fs.writeFile(extensionsLockPath(tmpDir), '{ not json', 'utf-8');
    const result = await verifyLockfile(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]?.packageName).toBe('(lockfile)');
  });
});
