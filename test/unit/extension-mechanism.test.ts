/**
 * Extension mechanism unit tests (T009 / T019–T027).
 *
 * Tests the extension infrastructure in isolation:
 *   - Shape validation (shape.ts)
 *   - Loader path security and timeout (loader.ts)
 *   - Registry snapshot, dispatch, runValidation (registry.ts)
 *
 * E2E CLI integration tests (mock) live in extension-e2e-mock.test.ts.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ExtensionRegistry } from '../../src/abap_cli/extensions/registry.js';
import { validateExtension } from '../../src/abap_cli/extensions/shape.js';
import { resolveLocalPath } from '../../src/abap_cli/extensions/loader.js';
import { extensionValidationFailed } from '../../src/abap_cli/extensions/errors.js';
import { CliError } from '../../src/abap_cli/output/json.js';
import { resetWarnings } from '../../src/abap_cli/output/meta.js';
import type { ExtensionManifest, ValidationContext } from '../../src/abap_cli/extensions/types.js';
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------

describe('validateExtension (shape.ts)', () => {
  it('accepts a valid command extension', () => {
    const ext = {
      type: 'command',
      name: 'myorg-hello',
      command: 'myorg-hello [name]',
      description: 'Says hello',
      action: () => {},
    };
    const result = validateExtension(ext);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe('command');
  });

  it('accepts a valid validation rule', () => {
    const ext = {
      type: 'validation',
      name: 'no-test-classes',
      appliesTo: ['push'],
      validate: () => ({ ok: true }),
    };
    const result = validateExtension(ext);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe('validation');
  });

  it('accepts a valid lifecycle hook', () => {
    const ext = {
      type: 'lifecycle',
      name: 'audit-logger',
      event: 'beforeCommand',
      hook: () => {},
    };
    const result = validateExtension(ext);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe('lifecycle');
  });

  it('rejects missing type', () => {
    // No type field → falls through to UNKNOWN_TYPE
    const result = validateExtension({ name: 'foo', action: () => {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_TYPE');
  });

  it('rejects unknown type', () => {
    const result = validateExtension({ type: 'unknown', name: 'foo' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_TYPE');
  });

  it('rejects missing name', () => {
    const result = validateExtension({ type: 'command', action: () => {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MISSING_NAME');
  });

  it('rejects invalid name format', () => {
    const result = validateExtension({ type: 'command', name: 'BadName-123', action: () => {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_NAME');
  });

  it('rejects command extension missing action', () => {
    const result = validateExtension({ type: 'command', name: 'test-cmd', command: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MISSING_ACTION');
  });

  it('rejects validation rule missing validate function', () => {
    const result = validateExtension({ type: 'validation', name: 'test-rule' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MISSING_VALIDATE');
  });

  it('rejects lifecycle hook with invalid event', () => {
    const result = validateExtension({ type: 'lifecycle', name: 'bad-hook', event: 'notAnEvent', hook: () => {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_EVENT');
  });

  it('rejects validation rule with invalid appliesTo', () => {
    const result = validateExtension({
      type: 'validation',
      name: 'bad-rule',
      appliesTo: 123,
      validate: () => ({ ok: true }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_APPLIES_TO');
  });

  it('rejects non-object input', () => {
    expect(validateExtension(null).ok).toBe(false);
    expect(validateExtension('string').ok).toBe(false);
    expect(validateExtension(42).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('resolveLocalPath (loader.ts)', () => {
  it('accepts a path under cwd', async () => {
    // Use project tmp dir so it's within the allowlist
    const subdir = mkdtempSync(join(process.cwd(), 'tmp', 'ext-test-'));
    const result = await resolveLocalPath(subdir);
    expect(result).toBe(subdir);
    rmSync(subdir, { recursive: true });
  });

  it('rejects path containing ..', async () => {
    await expect(resolveLocalPath('../../etc/passwd')).rejects.toThrow();
  });

  it('rejects path escaping allowlist via ..', async () => {
    await expect(resolveLocalPath('/tmp/../../../etc/passwd')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('ExtensionRegistry', () => {
  beforeEach(() => {
    resetWarnings();
  });

  describe('snapshot()', () => {
    it('returns empty meta when nothing loaded', () => {
      const registry = new ExtensionRegistry();
      const snap = registry.snapshot();
      expect(snap.loaded).toBe(0);
      expect(snap.names).toHaveLength(0);
      expect(snap.byType).toEqual({});
    });
  });

  describe('loadAndRegisterExtensions', () => {
    it('records failed extension when path does not exist', async () => {
      const registry = new ExtensionRegistry();
      const manifest: ExtensionManifest = {
        type: 'validation',
        name: 'missing-rule',
        source: { sourceType: 'path', path: '/tmp/does-not-exist-12345/ext.ts' },
      };
      await registry.loadAndRegisterExtensions({} as never, [manifest]);
      const snap = registry.snapshot();
      expect(snap.loaded).toBe(0);
      expect(snap.failed).toBe(1);
      expect(snap.names).toHaveLength(0);
    });

    it('loads a valid local ValidationRule extension', async () => {
      const dir = mkdtempSync(join(process.cwd(), 'tmp', 'ext-'));
      const extPath = join(dir, 'valid-rule.mjs');
      writeFileSync(extPath, `
        export default {
          type: 'validation',
          name: 'test-rule',
          appliesTo: '*',
          validate: () => ({ ok: true }),
        };
      `);
      const registry = new ExtensionRegistry();
      const manifest: ExtensionManifest = {
        type: 'validation',
        name: 'test-rule',
        source: { sourceType: 'path', path: extPath },
      };
      await registry.loadAndRegisterExtensions({} as never, [manifest]);
      const snap = registry.snapshot();
      expect(snap.loaded).toBe(1);
      expect(snap.failed).toBeUndefined();
      expect(snap.names).toContain('test-rule');
      rmSync(dir, { recursive: true });
    });

    it('loads a valid local LifecycleHook extension', async () => {
      const dir = mkdtempSync(join(process.cwd(), 'tmp', 'ext-'));
      const extPath = join(dir, 'lifecycle-hook.mjs');
      writeFileSync(extPath, `
        export default {
          type: 'lifecycle',
          name: 'audit-logger',
          event: 'beforeCommand',
          hook: () => {},
        };
      `);
      const registry = new ExtensionRegistry();
      const manifest: ExtensionManifest = {
        type: 'lifecycle',
        name: 'audit-logger',
        source: { sourceType: 'path', path: extPath },
      };
      await registry.loadAndRegisterExtensions({} as never, [manifest]);
      const snap = registry.snapshot();
      expect(snap.loaded).toBe(1);
      expect(snap.names).toContain('audit-logger');
      rmSync(dir, { recursive: true });
    });
  });

  describe('runValidation', () => {
    it('passes when no rules are registered', async () => {
      const registry = new ExtensionRegistry();
      const ctx: ValidationContext = { command: 'push', argv: ['push'], files: [] };
      await expect(registry.runValidation('push', ctx)).resolves.toBeUndefined();
    });

    it('throws EXTENSION_VALIDATION_FAILED when rule rejects', async () => {
      const dir = mkdtempSync(join(process.cwd(), 'tmp', 'ext-'));
      const extPath = join(dir, 'reject-rule.mjs');
      writeFileSync(extPath, `
        export default {
          type: 'validation',
          name: 'no-test-files',
          appliesTo: ['push'],
          validate: (ctx) => {
            const hasTest = ctx.files?.some(f => f.includes('test'));
            return hasTest
              ? { ok: false, message: 'No test files allowed', violation: 'test-in-path' }
              : { ok: true };
          },
        };
      `);
      const registry = new ExtensionRegistry();
      const manifest: ExtensionManifest = {
        type: 'validation',
        name: 'no-test-files',
        source: { sourceType: 'path', path: extPath },
      };
      await registry.loadAndRegisterExtensions({} as never, [manifest]);

      const ctx: ValidationContext = {
        command: 'push',
        argv: ['push'],
        files: ['/project/src/test-file.abap'],
      };
      await expect(registry.runValidation('push', ctx)).rejects.toThrow();
      try {
        await registry.runValidation('push', ctx);
      } catch (err) {
        expect(err).toBeInstanceOf(CliError);
        if (err instanceof CliError) {
          expect(err.code).toBe('EXTENSION_VALIDATION_FAILED');
        }
      }
      rmSync(dir, { recursive: true });
    });
  });

  describe('dispatch', () => {
    it('calls beforeCommand hook when dispatched', async () => {
      const dir = mkdtempSync(join(process.cwd(), 'tmp', 'ext-'));
      const extPath = join(dir, 'lifecycle.mjs');
      // Use globalThis so the loaded module can set a flag the test can read
      const flagKey = 'ext_hook_called_' + Date.now();
      writeFileSync(extPath, `
        export default {
          type: 'lifecycle',
          name: 'counter',
          event: 'beforeCommand',
          hook: () => { globalThis['${flagKey}'] = true; },
        };
      `);
      const registry = new ExtensionRegistry();
      const manifest: ExtensionManifest = {
        type: 'lifecycle',
        name: 'counter',
        source: { sourceType: 'path', path: extPath },
      };
      await registry.loadAndRegisterExtensions({} as never, [manifest]);
      await registry.dispatch('beforeCommand', { command: 'push', argv: ['push'], ts: Date.now() });
      expect(globalThis[flagKey]).toBe(true);
      delete globalThis[flagKey];
      rmSync(dir, { recursive: true });
    });
  });

  describe('dispatchAll (onError isolation)', () => {
    it('returns settled results even when hooks throw', async () => {
      const dir = mkdtempSync(join(process.cwd(), 'tmp', 'ext-'));
      const extPath = join(dir, 'bad-hook.mjs');
      writeFileSync(extPath, `
        export default {
          type: 'lifecycle',
          name: 'bad-hook',
          event: 'onError',
          hook: () => { throw new Error('hook failed'); },
        };
      `);
      const registry = new ExtensionRegistry();
      const manifest: ExtensionManifest = {
        type: 'lifecycle',
        name: 'bad-hook',
        source: { sourceType: 'path', path: extPath },
      };
      await registry.loadAndRegisterExtensions({} as never, [manifest]);
      const results = await registry.dispatchAll('onError', {
        command: 'push',
        argv: ['push'],
        error: { code: 'SAP_ERROR', message: 'server error', category: 'SAP_ERROR' },
        ts: Date.now(),
      });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('rejected');
      rmSync(dir, { recursive: true });
    });
  });

  describe('metaFragment', () => {
    it('returns undefined when no extensions loaded', () => {
      const registry = new ExtensionRegistry();
      expect(registry.metaFragment('push')).toBeUndefined();
    });

    it('includes validationRules relevant to current command', async () => {
      const dir = mkdtempSync(join(process.cwd(), 'tmp', 'ext-'));
      const extPath = join(dir, 'vr.mjs');
      writeFileSync(extPath, `
        export default {
          type: 'validation',
          name: 'push-rule',
          appliesTo: ['push'],
          validate: () => ({ ok: true }),
        };
      `);
      const registry = new ExtensionRegistry();
      await registry.loadAndRegisterExtensions({} as never, [{
        type: 'validation',
        name: 'push-rule',
        source: { sourceType: 'path', path: extPath },
      }]);
      const frag = registry.metaFragment('push');
      expect(frag).toBeDefined();
      expect(frag!.validationRules).toBeDefined();
      expect(frag!.validationRules!.some((r) => r.name === 'push-rule')).toBe(true);
      rmSync(dir, { recursive: true });
    });
  });
});

// ---------------------------------------------------------------------------
// Error factories
// ---------------------------------------------------------------------------

describe('extensionValidationFailed (errors.ts)', () => {
  it('produces a VALIDATION_ERROR CliError', () => {
    const err = extensionValidationFailed('my-rule', 'src/foo.abap', 'test violation');
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe('EXTENSION_VALIDATION_FAILED');
    expect(err.details).toMatchObject({ rule: 'my-rule', file: 'src/foo.abap', violation: 'test violation' });
  });
});
