import { describe, expect, it } from 'vitest';
import { deduplicateTablArtifactTargets, deduplicateXsltArtifactTargets } from '../../src/abap_cli/flows/edit/push-dedup.js';

describe('push TABL/STRU artifact dedup', () => {
  it('collapses the full artifact trio to a single file (first seen wins)', () => {
    const input = [
      'src/Database Tables/ztab.tabl.json',
      'src/Database Tables/ztab.tabl.ddic',
      'src/Database Tables/ztab.tabl.settings.json',
    ];

    const out = deduplicateTablArtifactTargets(input);

    // First in iteration order wins — here the canonical .json path keeps its
    // position so the later dependency sort still routes it to priority 30.
    expect(out).toEqual(['src/Database Tables/ztab.tabl.json']);
  });

  it('keeps the first sidecar in iteration order (stable dedup)', () => {
    // Both sidecars map to the same canonical main; the first one wins.
    const input = [
      'src/Database Tables/ztab.tabl.ddic',
      'src/Database Tables/ztab.tabl.json',
    ];

    const out = deduplicateTablArtifactTargets(input);

    expect(out).toEqual(['src/Database Tables/ztab.tabl.ddic']);
  });

  it('treats case-only differences as the same artifact group', () => {
    const input = [
      'src/Tables/ztab.TABL.JSON',
      'src/Tables/ztab.tabl.ddic',
    ];

    const out = deduplicateTablArtifactTargets(input);

    expect(out).toEqual(['src/Tables/ztab.TABL.JSON']);
  });

  it('passes non-artifact files through unchanged', () => {
    const input = [
      'src/Programs/ztool.prog.abap',
      'src/Classes/zcl_x.clas.abap',
      'src/Database Tables/ztab.tabl.json',
    ];

    const out = deduplicateTablArtifactTargets(input);

    expect(out).toEqual([
      'src/Programs/ztool.prog.abap',
      'src/Classes/zcl_x.clas.abap',
      'src/Database Tables/ztab.tabl.json',
    ]);
  });

  it('dedups multiple independent artifact groups in one pass', () => {
    const input = [
      'src/Database Tables/ztab_a.tabl.ddic',
      'src/Database Tables/ztab_a.tabl.json',
      'src/Database Tables/ztab_b.tabl.json',
      'src/Database Tables/ztab_b.tabl.ddic',
      'src/Database Tables/ztab_b.tabl.settings.json',
    ];

    const out = deduplicateTablArtifactTargets(input);

    expect(out).toEqual([
      'src/Database Tables/ztab_a.tabl.ddic',
      'src/Database Tables/ztab_b.tabl.json',
    ]);
  });

  it('handles STRU sidecars the same as TABL', () => {
    const input = [
      'src/Types/zstr.stru.ddic',
      'src/Types/zstr.stru.json',
    ];

    const out = deduplicateTablArtifactTargets(input);

    expect(out).toEqual(['src/Types/zstr.stru.ddic']);
  });
});

describe('push XSLT pair dedup', () => {
  it('collapses a pushed .xslt.json + .xslt.xml pair to the JSON metadata file', () => {
    const input = ['src/zmy_xslt.xslt.xml', 'src/zmy_xslt.xslt.json'];
    expect(deduplicateXsltArtifactTargets(input)).toEqual(['src/zmy_xslt.xslt.json']);
    // Input order is preserved for the surviving entry.
    expect(deduplicateXsltArtifactTargets([...input].reverse())).toEqual([
      'src/zmy_xslt.xslt.json',
    ]);
  });

  it('keeps a lone .xslt.xml (source-side push is supported)', () => {
    expect(deduplicateXsltArtifactTargets(['src/zmy_xslt.xslt.xml'])).toEqual([
      'src/zmy_xslt.xslt.xml',
    ]);
  });

  it('dedups multiple independent pairs and passes non-XSLT files through', () => {
    const input = [
      'src/zmy_a.xslt.json',
      'src/zmy_a.xslt.xml',
      'src/zcl_x.clas.abap',
      'src/zmy_b.xslt.xml',
    ];
    expect(deduplicateXsltArtifactTargets(input)).toEqual([
      'src/zmy_a.xslt.json',
      'src/zcl_x.clas.abap',
      'src/zmy_b.xslt.xml',
    ]);
  });

  it('is case-insensitive for the extension only', () => {
    const input = ['src/Zmy_Xslt.XSLT.XML', 'src/Zmy_Xslt.XSLT.JSON'];
    expect(deduplicateXsltArtifactTargets(input)).toEqual(['src/Zmy_Xslt.XSLT.JSON']);
  });
});
