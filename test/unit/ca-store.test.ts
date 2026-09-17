/**
 * ca-store unit tests — content-addressed PEM store under the user config dir.
 *
 * Coverage:
 *   - PEM file is imported once, content-addressed by sha256, idempotent.
 *   - non-PEM / non-certificate input is rejected with INVALID_ARGUMENT.
 *   - missing source file → CONFIG_ERROR.
 *   - stored file is 0600; directory is 0700 (best-effort).
 *   - readCa surfaces a CONFIG_ERROR that points at `profile set --ca` for repair.
 *   - removeCaIfOrphan only deletes when no other profile still references the sha.
 *   - fingerprint is a short prefix.
 *
 * `ABAP_CLI_CERT_DIR` overrides the store root so the suite stays hermetic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  CERT_DIR_ENV,
  certDir,
  fingerprint,
  importCaPem,
  readCa,
  removeCaIfOrphan,
} from '../../src/abap_cli/config/ca-store.js';

const SAMPLE_PEM = '-----BEGIN CERTIFICATE-----\nMIIBdummy\n-----END CERTIFICATE-----\n';

let tmpRoot: string;
/** Separate dir for source PEMs — keeps store listings unambiguous. */
let srcDir: string;
let prevDir: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-cli-ca-store-'));
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abap-cli-ca-src-'));
  prevDir = process.env[CERT_DIR_ENV];
  process.env[CERT_DIR_ENV] = tmpRoot;
});

afterEach(() => {
  if (prevDir === undefined) delete process.env[CERT_DIR_ENV];
  else process.env[CERT_DIR_ENV] = prevDir;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(srcDir, { recursive: true, force: true });
});

/** Write a source PEM into the source dir and return its path. */
function writeSrc(name: string, content = SAMPLE_PEM): string {
  const p = path.join(srcDir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('importCaPem', () => {
  it('imports a PEM file and returns its stored path + sha256', () => {
    const result = importCaPem(writeSrc('in.pem'));
    expect(result.storedPath).toBe(path.join(tmpRoot, `${result.sha256}.pem`));
    expect(fs.existsSync(result.storedPath)).toBe(true);
    expect(result.sha256).toBe(createHash('sha256').update(SAMPLE_PEM).digest('hex'));
    expect(result.importedAt).toMatch(/T/); // ISO timestamp
    expect(fs.readFileSync(result.storedPath, 'utf-8')).toBe(SAMPLE_PEM);
  });

  it('is idempotent — importing the same bytes twice returns the same path', () => {
    const first = importCaPem(writeSrc('a.pem'));
    const second = importCaPem(writeSrc('b.pem'));
    expect(second.storedPath).toBe(first.storedPath);
    expect(second.sha256).toBe(first.sha256);
    // One content-addressed file, no stray tmp files left behind.
    expect(fs.readdirSync(tmpRoot)).toEqual([`${first.sha256}.pem`]);
  });

  it('rejects a non-PEM file with INVALID_ARGUMENT', () => {
    expect(() => importCaPem(writeSrc('junk.txt', 'hello world\n'))).toThrowError(/not a PEM certificate/);
  });

  it('rejects a private key block (only certificates may enter the store)', () => {
    const src = writeSrc('key.pem', '-----BEGIN PRIVATE KEY-----\nMIIBdummy\n-----END PRIVATE KEY-----\n');
    expect(() => importCaPem(src)).toThrowError(/not a PEM certificate/);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  it('throws CONFIG_ERROR when the source file is missing', () => {
    expect(() => importCaPem(path.join(srcDir, 'absent.pem'))).toThrowError(/Cannot read CA certificate/);
  });

  it('writes the stored file with mode 0600', () => {
    const result = importCaPem(writeSrc('perm.pem'));
    const mode = fs.statSync(result.storedPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('readCa', () => {
  it('returns the stored PEM content', () => {
    const result = importCaPem(writeSrc('in.pem'));
    expect(readCa(result.storedPath)).toBe(SAMPLE_PEM);
  });

  it('surfaces a re-import hint when the stored file is missing', () => {
    expect(() => readCa(path.join(tmpRoot, 'gone.pem'))).toThrowError(/profile set .* --ca/);
  });

  it('throws CONFIG_ERROR for an empty path', () => {
    expect(() => readCa('')).toThrowError(/CA certificate path is empty/);
  });
});

describe('removeCaIfOrphan', () => {
  it('removes the stored file when no other profile still references it', () => {
    const result = importCaPem(writeSrc('in.pem'));
    expect(removeCaIfOrphan(result.sha256, 0)).toBe(true);
    expect(fs.existsSync(result.storedPath)).toBe(false);
  });

  it('keeps the file when referenceCount > 0', () => {
    const result = importCaPem(writeSrc('in.pem'));
    expect(removeCaIfOrphan(result.sha256, 1)).toBe(false);
    expect(fs.existsSync(result.storedPath)).toBe(true);
  });

  it('returns false when the file does not exist', () => {
    expect(removeCaIfOrphan('0'.repeat(64), 0)).toBe(false);
  });
});

describe('fingerprint / certDir', () => {
  it('returns the first N hex chars', () => {
    expect(fingerprint('abcdef0123456789', 8)).toBe('abcdef01');
    expect(fingerprint('abcdef0123456789')).toBe('abcdef0123456789'.slice(0, 16));
  });

  it('certDir honours ABAP_CLI_CERT_DIR', () => {
    expect(certDir()).toBe(tmpRoot);
  });
});
