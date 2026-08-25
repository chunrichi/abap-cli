import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scaffoldAgents } from '../../src/abap_cli/flows/init-agents.js';

/**
 * Each test gets a tmp dir we point `process.cwd()` at (init-agents uses
 * `process.cwd()` as the destination root).
 */
describe('init --agent (scaffoldAgents)', () => {
  let cwd: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-agents-'));
    const { vi } = await import('vitest');
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  function expectFile(p: string): void {
    expect(fs.existsSync(p), `expected ${p} to exist`).toBe(true);
  }

  function expectNoFile(p: string): void {
    expect(fs.existsSync(p), `did NOT expect ${p} to exist`).toBe(false);
  }

  describe('path layout per vendor', () => {
    it.each([
      ['copilot', '.github'],
      ['claude', '.claude'],
      ['cursor', '.cursor'],
      ['generic', '.agents'],
    ] as const)('%s writes skills/ and agents/ under %s/', async (target, vendorDir) => {
      const result = await scaffoldAgents(target, false);
      expect(result.skipped).toEqual([]);

      // Two skills copied to vendor skills dir.
      expectFile(path.join(cwd, vendorDir, 'skills', 'abap-setup', 'SKILL.md'));
      expectFile(path.join(cwd, vendorDir, 'skills', 'abap-object', 'SKILL.md'));

      // Agent copied to vendor agents dir.
      expectFile(path.join(cwd, vendorDir, 'agents', 'abap-developer.md'));
    });

    it('claude also writes CLAUDE.md at workspace root', async () => {
      const result = await scaffoldAgents('claude', false);
      expect(result.written).toContain('CLAUDE.md');
      expectFile(path.join(cwd, 'CLAUDE.md'));
    });

    it('cursor also writes .cursor/rules/abap.mdc', async () => {
      const result = await scaffoldAgents('cursor', false);
      expect(result.written).toContain('.cursor/rules/abap.mdc');
      expectFile(path.join(cwd, '.cursor', 'rules', 'abap.mdc'));
    });

    it('copilot does NOT write CLAUDE.md or .cursor/rules/abap.mdc (those are vendor-specific overlays)', async () => {
      const result = await scaffoldAgents('copilot', false);
      expect(result.written.join(' ')).not.toContain('CLAUDE.md');
      expect(result.written.join(' ')).not.toContain('.cursor/');
      expectNoFile(path.join(cwd, 'CLAUDE.md'));
      expectNoFile(path.join(cwd, '.cursor'));
    });
  });

  describe('forbidden files (user requirement + repo layout)', () => {
    it('never writes AGENTS.md (user requirement)', async () => {
      for (const target of ['generic', 'copilot', 'claude', 'cursor'] as const) {
        // fresh tmp per iteration
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-agents-'));
        cwdSpy.mockReturnValue(cwd);
        await scaffoldAgents(target, false);
        expectNoFile(path.join(cwd, 'AGENTS.md'));
      }
    });

    it('never writes copilot-instructions.md (user requirement)', async () => {
      for (const target of ['generic', 'copilot', 'claude', 'cursor'] as const) {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-agents-'));
        cwdSpy.mockReturnValue(cwd);
        await scaffoldAgents(target, false);
        expectNoFile(path.join(cwd, 'copilot-instructions.md'));
        expectNoFile(path.join(cwd, '.github', 'copilot-instructions.md'));
      }
    });

    it('never copies skills/README.md (repo metadata, not user content)', async () => {
      for (const target of ['generic', 'copilot', 'claude', 'cursor'] as const) {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-agents-'));
        cwdSpy.mockReturnValue(cwd);
        const result = await scaffoldAgents(target, false);
        const all = [...result.written, ...result.skipped];
        expect(
          all.some((p) => p.endsWith('README.md')),
          `vendor ${target} should not copy any README.md; saw: ${all.join(', ')}`,
        ).toBe(false);
        // Spot-check the .github/ case specifically.
        if (target === 'copilot') {
          expectNoFile(path.join(cwd, '.github', 'skills', 'README.md'));
        }
      }
    });

    it('never pollutes the workspace root with skills/ or agents/ directories', async () => {
      // Critical: init used to dump skills/ and agents/ at the workspace root.
      // That was the user-reported bug. Now everything goes under the vendor dir.
      for (const target of ['generic', 'copilot', 'claude', 'cursor'] as const) {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'init-agents-'));
        cwdSpy.mockReturnValue(cwd);
        await scaffoldAgents(target, false);
        expectNoFile(path.join(cwd, 'skills'));
        expectNoFile(path.join(cwd, 'agents'));
      }
    });
  });

  describe('idempotence and --force', () => {
    it('second run with no --force reports files as skipped', async () => {
      await scaffoldAgents('copilot', false);
      const second = await scaffoldAgents('copilot', false);
      expect(second.written).toEqual([]);
      expect(second.skipped.length).toBeGreaterThan(0);
      // None of the skipped should be README.md (still excluded).
      expect(second.skipped.some((p) => p.endsWith('README.md'))).toBe(false);
      // And all skipped paths are vendor-prefixed so agents see the actual location.
      expect(second.skipped.every((p) => p.startsWith('.github/'))).toBe(true);
    });

    it('--force overwrites existing files', async () => {
      await scaffoldAgents('copilot', false);
      // Tamper with a skill file to prove --force really overwrites.
      const skillPath = path.join(cwd, '.github', 'skills', 'abap-setup', 'SKILL.md');
      fs.writeFileSync(skillPath, 'tampered');
      const result = await scaffoldAgents('copilot', true);
      expect(result.written.some((p) => p.endsWith('SKILL.md'))).toBe(true);
      expect(fs.readFileSync(skillPath, 'utf-8')).not.toBe('tampered');
    });
  });

  describe('JSON output is vendor-prefixed (token-efficient)', () => {
    it.each([
      ['copilot', '.github'],
      ['generic', '.agents'],
    ] as const)('%s: every written/skipped path is vendor-prefixed', async (target, vendorDir) => {
      const result = await scaffoldAgents(target, false);
      // Every written path is vendor-prefixed (no overlays for these targets).
      expect(result.written.every((p) => p.startsWith(`${vendorDir}/`))).toBe(true);
      // And none start with bare `skills/` or `agents/` (which would be ambiguous).
      expect(result.written.some((p) => p.startsWith('skills/') || p.startsWith('agents/'))).toBe(false);
    });

    it('claude: skills/agents paths are vendor-prefixed; CLAUDE.md is left unprefixed (overlay)', async () => {
      const result = await scaffoldAgents('claude', false);
      // skills/* / agents/* paths get the .claude/ prefix.
      const skillAgent = result.written.filter((p) => /^(skills|agents)\//.test(p));
      expect(skillAgent).toEqual([]);
      const skillAgentPrefixed = result.written.filter((p) => p.startsWith('.claude/skills/') || p.startsWith('.claude/agents/'));
      expect(skillAgentPrefixed.length).toBeGreaterThan(0);
      // CLAUDE.md is an overlay that lives at workspace root by design.
      expect(result.written).toContain('CLAUDE.md');
    });

    it('cursor: skills/agents paths are vendor-prefixed; .cursor/rules/abap.mdc is left unprefixed', async () => {
      const result = await scaffoldAgents('cursor', false);
      const skillAgent = result.written.filter((p) => /^(skills|agents)\//.test(p));
      expect(skillAgent).toEqual([]);
      // .cursor/rules/abap.mdc is the overlay (already vendor-prefixed; not double-prefixed).
      expect(result.written).toContain('.cursor/rules/abap.mdc');
      expect(result.written.some((p) => p.startsWith('.cursor/.cursor/'))).toBe(false);
    });
  });

  describe('invalid target', () => {
    it('rejects unknown targets with USAGE error', async () => {
      await expect(
        scaffoldAgents('foo' as unknown as 'copilot', false),
      ).rejects.toMatchObject({ code: 'USAGE' });
    });
  });
});