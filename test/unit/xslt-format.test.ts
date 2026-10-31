/**
 * XSLT AFF pair: schema validation, wire mapping and line-ending normalisation.
 *
 * The pair is `<name>.xslt.json` (abap-file-format xslt-v1 metadata) plus
 * `<name>.xslt.xml` (the transformation source). SAP read-back adds one
 * trailing CRLF at runtime, so the canonical local form is LF with no trailing
 * line break — `normalizeXsltSource()` is the single implementation.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  localToWire,
  normalizeXsltSource,
  sameXsltSource,
  wireToLocal,
  xsltArtifact,
  xsltSourceFileContent,
  type XsltLocal,
} from '../../src/abap_cli/formats/xslt/json.js';
import {
  readXsltPair,
  writeXsltPair,
  xsltPairPaths,
  xsltPathsForObject,
} from '../../src/abap_cli/formats/xslt/companion.js';
import { checkCompanions } from '../../src/abap_cli/aff/companion-check.js';
import { routeAffSchema } from '../../src/abap_cli/aff/router.js';

const VALID_DOC: XsltLocal = {
  formatVersion: '1',
  header: { description: 'My transformation', originalLanguage: 'EN' },
};

const SOURCE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<xsl:transform version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">',
  '  <xsl:template match="/">',
  '    <out><xsl:value-of select="/root/value"/></out>',
  '  </xsl:template>',
  '</xsl:transform>',
].join('\n');

describe('XSLT AFF metadata schema (xslt-v1.json)', () => {
  it('accepts the canonical header-only document', async () => {
    await expect(xsltArtifact.validate(VALID_DOC)).resolves.toEqual([]);
  });

  it('rejects a document without header.description', async () => {
    const errors = await xsltArtifact.validate({ formatVersion: '1', header: { originalLanguage: 'EN' } });
    expect(errors.join('; ')).toMatch(/description/);
  });

  it('rejects a formatVersion other than "1" and undeclared top-level fields', async () => {
    const wrongVersion = await xsltArtifact.validate({
      formatVersion: '2',
      header: { description: 'x', originalLanguage: 'EN' },
    });
    expect(wrongVersion.join('; ')).toMatch(/formatVersion/);

    const extra = await xsltArtifact.validate({
      ...VALID_DOC,
      category: 'unknown',
    } as unknown as XsltLocal);
    expect(extra.join('; ')).toMatch(/additional propert/);
  });
});

describe('XSLT line-ending normalisation', () => {
  it('normalises CRLF/CR to LF and strips trailing line breaks', () => {
    expect(normalizeXsltSource('a\r\nb\r\n\r\n')).toBe('a\nb');
    expect(normalizeXsltSource('a\rb\r')).toBe('a\nb');
    expect(normalizeXsltSource('a\nb\n')).toBe('a\nb');
    expect(normalizeXsltSource('a\nb')).toBe('a\nb');
    expect(normalizeXsltSource('')).toBe('');
  });

  it('is idempotent and preserves internal blank lines and trailing spaces', () => {
    const once = normalizeXsltSource('line1  \n\nline2\r\n');
    expect(once).toBe('line1  \n\nline2');
    expect(normalizeXsltSource(once)).toBe(once);
  });

  it('SAP read-back (CRLF + one extra trailing break) compares equal to the local form', () => {
    const sapReadback = `${SOURCE.replace(/\n/g, '\r\n')}\r\n`;
    expect(sameXsltSource(sapReadback, `${SOURCE}\n`)).toBe(true);
    expect(sameXsltSource(sapReadback, SOURCE.replace('/root/value', '/other/value'))).toBe(false);
  });

  it('writes exactly one trailing newline in the .xslt.xml file content', () => {
    expect(xsltSourceFileContent(`${SOURCE}\n\n`)).toBe(`${SOURCE}\n`);
    expect(xsltSourceFileContent('')).toBe('');
  });
});

describe('XSLT wire mapping', () => {
  it('builds the ICF payload with normalised source and optional envelope', () => {
    const wire = localToWire(
      { ...VALID_DOC, header: { description: 'desc', originalLanguage: 'en' } },
      `${SOURCE}\r\n`,
      { name: 'zmy_xslt', package: '$TMP', transportRequest: 'NDK1' },
    );
    expect(wire).toEqual({
      name: 'ZMY_XSLT',
      header: { description: 'desc', originalLanguage: 'en' },
      source: SOURCE,
      package: '$TMP',
      transportRequest: 'NDK1',
    });
  });

  it('maps the pulled wire back to the local AFF shape (EN fallback, uppercase ISO)', () => {
    expect(
      wireToLocal({ name: 'ZMY_XSLT', description: 'd', originalLanguage: 'de', source: SOURCE }),
    ).toEqual({ formatVersion: '1', header: { description: 'd', originalLanguage: 'DE' } });
    expect(
      wireToLocal({ name: 'ZMY_XSLT', description: 'd', originalLanguage: '', source: SOURCE }).header.originalLanguage,
    ).toBe('EN');
  });
});

describe('XSLT pair paths', () => {
  it('resolves the sibling path from either side of the pair', () => {
    expect(xsltPairPaths('/w/src/foo.xslt.json')).toEqual({
      jsonPath: '/w/src/foo.xslt.json',
      xmlPath: '/w/src/foo.xslt.xml',
    });
    expect(xsltPairPaths('/w/src/foo.xslt.xml')).toEqual({
      jsonPath: '/w/src/foo.xslt.json',
      xmlPath: '/w/src/foo.xslt.xml',
    });
    expect(() => xsltPairPaths('/w/src/foo.tran.json')).toThrow(/Not an XSLT file/);
  });

  it('uses the AFF namespace token for namespaced objects', () => {
    const paths = xsltPathsForObject('src', '/ZNS/MY_XSLT');
    expect(paths.jsonPath.endsWith(path.join('src', '(zns)my_xslt.xslt.json'))).toBe(true);
    expect(paths.xmlPath.endsWith(path.join('src', '(zns)my_xslt.xslt.xml'))).toBe(true);
  });
});

describe('XSLT pair read/write + companion check', () => {
  it('reads the pair, validates the JSON and normalises the source', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xslt-pair-'));
    try {
      const paths = xsltPathsForObject(dir, 'ZMY_XSLT');
      await writeXsltPair(paths, VALID_DOC, `${SOURCE}\n\n`);
      expect(await fs.readFile(paths.jsonPath, 'utf8')).toBe(`${JSON.stringify(VALID_DOC, null, 2)}\n`);
      expect(await fs.readFile(paths.xmlPath, 'utf8')).toBe(`${SOURCE}\n`);

      const pair = await readXsltPair(paths.jsonPath);
      expect(pair.local).toEqual(VALID_DOC);
      expect(pair.source).toBe(SOURCE);

      // The pair is complete: no structural companion gaps.
      const check = await checkCompanions(paths.jsonPath);
      expect(check.missing).toEqual([]);
      expect(check.severity).toBe('ok');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('fails with an actionable error when the XML companion is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xslt-pair-'));
    try {
      const paths = xsltPathsForObject(dir, 'ZMY_XSLT');
      await fs.writeFile(paths.jsonPath, JSON.stringify(VALID_DOC, null, 2) + '\n');
      await expect(readXsltPair(paths.jsonPath)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/companion file missing/),
      });
      const check = await checkCompanions(paths.jsonPath);
      expect(check.missing).toEqual(['zmy_xslt.xslt.xml']);
      expect(check.severity).toBe('structural');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an empty source companion instead of posting it to SAP', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xslt-pair-'));
    try {
      const paths = xsltPathsForObject(dir, 'ZMY_XSLT');
      await writeXsltPair(paths, VALID_DOC, '');
      await expect(readXsltPair(paths.jsonPath)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/empty/),
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('XSLT AFF router entries', () => {
  it('routes both files of the pair to XSLT with the xslt-v1 schema', () => {
    expect(routeAffSchema('src/zmy_xslt.xslt.json')).toEqual({
      type: 'XSLT',
      isJson: true,
      schemaFile: 'xslt-v1.json',
    });
    expect(routeAffSchema('src/zmy_xslt.xslt.xml')).toEqual({
      type: 'XSLT',
      isJson: false,
      schemaFile: 'xslt-v1.json',
    });
    expect(routeAffSchema('src/(zns)my_xslt.xslt.json')?.type).toBe('XSLT');
  });
});
