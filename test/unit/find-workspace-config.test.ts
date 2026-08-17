import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findWorkspaceConfig } from '../../src/abap_cli/config/project-config.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'find-ws-'));
}

describe('findWorkspaceConfig', () => {
  it('returns null when neither start nor any ancestor has .abap.json', () => {
    const root = tmpDir();
    // No .abap.json anywhere up to the tmp root (and .git boundary stops the walk).
    expect(findWorkspaceConfig(root)).toBeNull();
  });

  it('returns the .abap.json directly in the start directory', () => {
    const root = tmpDir();
    const configPath = path.join(root, '.abap.json');
    fs.writeFileSync(configPath, JSON.stringify({ system: 'a' }));
    expect(findWorkspaceConfig(root)).toBe(configPath);
  });

  it('walks up to the parent .abap.json when start has none', () => {
    const root = tmpDir();
    const child = path.join(root, 'pkg', 'sub');
    fs.mkdirSync(child, { recursive: true });
    const parentConfig = path.join(root, '.abap.json');
    fs.writeFileSync(parentConfig, JSON.stringify({ system: 'parent' }));
    expect(findWorkspaceConfig(child)).toBe(parentConfig);
  });

  it('child .abap.json wins over an ancestor .abap.json', () => {
    const root = tmpDir();
    const child = path.join(root, 'pkg', 'sub');
    fs.mkdirSync(child, { recursive: true });
    const parentConfig = path.join(root, '.abap.json');
    const childConfig = path.join(child, '.abap.json');
    fs.writeFileSync(parentConfig, JSON.stringify({ system: 'parent' }));
    fs.writeFileSync(childConfig, JSON.stringify({ system: 'child' }));
    expect(findWorkspaceConfig(child)).toBe(childConfig);
  });

  it('stops at the repository root (.git boundary) and does not search beyond it', () => {
    // Repo: /tmp/.../repo/.git/  (no .abap.json inside repo)
    // Outer: /tmp/.../outer/.abap.json   should NOT be found.
    const outer = tmpDir();
    const repo = path.join(outer, 'repo');
    const child = path.join(repo, 'pkg');
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(outer, '.abap.json'), JSON.stringify({ system: 'outer' }));
    expect(findWorkspaceConfig(child)).toBeNull();
  });

  it('does not cross the .git boundary even when there is a .abap.json further up', () => {
    const outer = tmpDir();
    const repo = path.join(outer, 'repo');
    const child = path.join(repo, 'pkg');
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(outer, '.abap.json'), JSON.stringify({ system: 'outer' }));
    // repo/.abap.json is found inside the repo boundary; outer one is not crossed.
    const repoConfig = path.join(repo, '.abap.json');
    fs.writeFileSync(repoConfig, JSON.stringify({ system: 'repo' }));
    expect(findWorkspaceConfig(child)).toBe(repoConfig);
  });

  it('finds the nearest .abap.json when several ancestors contain one', () => {
    const root = tmpDir();
    const mid = path.join(root, 'mid');
    const child = path.join(mid, 'sub');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(root, '.abap.json'), JSON.stringify({ system: 'root' }));
    fs.writeFileSync(path.join(mid, '.abap.json'), JSON.stringify({ system: 'mid' }));
    expect(findWorkspaceConfig(child)).toBe(path.join(mid, '.abap.json'));
  });
});