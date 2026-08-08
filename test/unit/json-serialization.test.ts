/**
 * 017 US1 (T004): JSON wire-contract guard for the ICF /textpool endpoint.
 *
 * Seeds special-character text elements (POST), reads them back (GET), and
 * asserts the response is standard-parseable JSON with lossless values — the
 * exact wire shape the ABAP handler must preserve after the /ui2/cl_json
 * unification (contracts/json-generation.md §4). The mock uses JSON.stringify
 * (correct escaping), so this guards the CONTRACT; the real-ABAP /ui2/cl_json
 * escaping path is verified on real SAP in T024.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MOCK = resolve(ROOT, 'test/mock-adt/server.js');
// 8081 avoids clashing with select-safety.test.ts (mock on 8080) under parallel vitest.
const PORT = 8081;

function startMock(port: number): Promise<{ proc: ChildProcess; port: number }> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('node', [MOCK, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('Mock ADT listening')) {
        proc.stdout?.off('data', onData);
        resolveP({ proc, port });
      }
    };
    proc.stdout?.on('data', onData);
    proc.on('error', rejectP);
    setTimeout(() => rejectP(new Error('mock-adt startup timeout')), 5000);
  });
}

const SPECIAL_TEXT = 'quote " backslash \\ newline\n中文 emoji 😀';
const MULTILINE_TEXT = 'line1\nline2\ttab "quoted" \\back\\slash';

describe('017 — ICF JSON wire contract (special-character lossless roundtrip)', () => {
  let proc: ChildProcess;
  let base: string;

  beforeAll(async () => {
    const m = await startMock(PORT);
    proc = m.proc;
    base = `http://localhost:${m.port}/sap/zabap_vibe/textpool`;
  });

  afterAll(() => {
    proc.kill('SIGTERM');
  });

  it('textpool elements with quotes/backslash/newline/unicode/emoji round-trip losslessly', async () => {
    // Seed via POST.
    const post = await fetch(`${base}/texts?object=ZOBJ_SPECIAL&type=PROG`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elements: [
          { id: 'I01', text: SPECIAL_TEXT },
          { id: 'I02', text: MULTILINE_TEXT },
        ],
      }),
    });
    expect(post.status).toBe(200);
    const postBody = JSON.parse(await post.text());
    expect(postBody.status).toBe('success');
    expect(postBody.data.written).toBe(2);

    // Read back via GET — parseable JSON, values lossless.
    const get = await fetch(`${base}/texts?object=ZOBJ_SPECIAL&type=PROG`);
    const getBody = JSON.parse(await get.text());
    expect(getBody.status).toBe('success');
    expect(getBody.data.elements).toEqual([
      { id: 'I01', text: SPECIAL_TEXT },
      { id: 'I02', text: MULTILINE_TEXT },
    ]);
  });

  it('empty textpool returns elements: [] (not null)', async () => {
    const get = await fetch(`${base}/texts?object=ZOBJ_EMPTY&type=PROG`);
    const getBody = JSON.parse(await get.text());
    expect(getBody.status).toBe('success');
    expect(getBody.data.elements).toEqual([]);
  });
});
