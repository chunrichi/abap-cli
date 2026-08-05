import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveFile } from '../../src/abap_cli/formats/file-resolver.js';

/**
 * P0.2 — verify the raw-Error → CliError conversions keep the contract shape.
 * The lint test (cli-error-boundary.test.ts) ensures no raw throws slip in;
 * this file asserts the CliError shape itself.
 */

describe('P0.2 — CliError shape for previously-raw throws', () => {
  describe('file-resolver.ts', () => {
    it('resolveFile throws CliError FILE_PARSE_ERROR for files with no extension', () => {
      try {
        resolveFile('some/path/justname');
        throw new Error('expected resolveFile to throw');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        // Contract fields present
        const e = error as { code?: string; category?: string; message?: string; nextSteps?: string[]; example?: string };
        expect(e.code).toBe('FILE_PARSE_ERROR');
        expect(e.message).toContain('justname');
        expect(Array.isArray(e.nextSteps)).toBe(true);
        expect(e.example).toContain('abap pull');
      }
    });
  });

  describe('user-config.ts', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('loadUserConfig throws CliError CONFIG_ERROR when the file is corrupt', async () => {
      vi.doMock('fs', () => ({
        existsSync: () => true,
        readFileSync: () => '{ not valid json',
        default: { existsSync: () => true, readFileSync: () => '{ not valid json' },
      }));
      const mod = await import('../../src/abap_cli/config/user-config.js');
      try {
        mod.loadUserConfig();
        throw new Error('expected loadUserConfig to throw');
      } catch (error: unknown) {
        const e = error as { code?: string; category?: string; message?: string; nextSteps?: string[]; example?: string };
        expect(e.code).toBe('CONFIG_ERROR');
        expect(e.message).toMatch(/Cannot parse user config/);
        expect(Array.isArray(e.nextSteps)).toBe(true);
        expect(e.example).toContain('connection add');
      } finally {
        vi.doUnmock('fs');
      }
    });
  });
});
