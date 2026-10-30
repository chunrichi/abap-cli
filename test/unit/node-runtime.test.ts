import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { SUPPORTED_NODE_RANGE, nodeSatisfies } from '../../src/abap_cli/flows/setup/node-runtime.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { engines: { node: string } };

describe('node-runtime', () => {
  it('declares the same range in package.json engines.node', () => {
    expect(pkg.engines.node).toBe(SUPPORTED_NODE_RANGE);
  });

  it.each(['v22.23.4', 'v22.24.0', 'v24.22.1', 'v24.30.0', 'v26.12.1', 'v27.0.0'])('accepts %s', (version) => {
    expect(nodeSatisfies(version)).toBe(true);
  });

  it.each(['v18.20.0', 'v20.19.0', 'v22.23.3', 'v24.22.0', 'v25.9.0', 'v26.12.0'])('rejects %s', (version) => {
    expect(nodeSatisfies(version)).toBe(false);
  });

  it('fails open on input it cannot parse', () => {
    expect(nodeSatisfies('not-a-version')).toBe(true);
    expect(nodeSatisfies('v22.23.4', 'not a range')).toBe(true);
  });
});
