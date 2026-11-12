import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface SiteObject {
  code: string;
  name: string;
  category: string;
  channel: string;
  create: string;
  pull: boolean;
  push: boolean;
  delete: string;
  artifacts: string;
}

interface SiteData {
  window: {
    ABAP_CATEGORIES?: { id: string; label: string }[];
    ABAP_OBJECTS?: SiteObject[];
    ABAP_STATS?: {
      total: number;
      create: number;
      pull: number;
      push: number;
      delete: number;
      readOnly: number;
      categories: number;
    };
  };
}

function loadSiteData(): SiteData {
  const file = path.resolve(process.cwd(), 'site/assets/objects.js');
  const context: SiteData = { window: {} };
  runInNewContext(readFileSync(file, 'utf8'), context);
  return context;
}

describe('project-site object matrix', () => {
  const { window } = loadSiteData();
  const categories = window.ABAP_CATEGORIES ?? [];
  const objects = window.ABAP_OBJECTS ?? [];
  const stats = window.ABAP_STATS;

  it('publishes the documented number of unique types and capabilities', () => {
    expect(objects).toHaveLength(51);
    expect(new Set(objects.map((row) => row.code)).size).toBe(51);
    expect(stats).toEqual({
      total: 51,
      create: 49,
      pull: 51,
      push: 47,
      delete: 49,
      readOnly: 2,
      categories: 7,
    });
  });

  it('keeps every row inside the rendering contract', () => {
    const categoryIds = new Set(categories.map((category) => category.id));
    for (const row of objects) {
      expect(row.code).toMatch(/^[A-Z0-9]+$/);
      expect(row.name.length).toBeGreaterThan(0);
      expect(categoryIds.has(row.category)).toBe(true);
      expect(['adt', 'icf', 'auto']).toContain(row.channel);
      expect(['direct', 'file', 'rf', 'none']).toContain(row.create);
      expect(['direct', 'tmp', 'none']).toContain(row.delete);
      expect(typeof row.pull).toBe('boolean');
      expect(typeof row.push).toBe('boolean');
      expect(row.artifacts.length).toBeGreaterThan(0);
    }
  });

  it('derives stats from the rows instead of trusting hand-written copy', () => {
    expect(stats?.create).toBe(objects.filter((row) => row.create !== 'none').length);
    expect(stats?.pull).toBe(objects.filter((row) => row.pull).length);
    expect(stats?.push).toBe(objects.filter((row) => row.push).length);
    expect(stats?.delete).toBe(objects.filter((row) => row.delete !== 'none').length);
    expect(stats?.readOnly).toBe(
      objects.filter((row) => !row.push && row.create === 'none' && row.delete === 'none').length,
    );
  });
});
