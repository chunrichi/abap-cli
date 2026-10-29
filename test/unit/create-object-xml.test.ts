import { describe, expect, it, vi } from 'vitest';
import { createObjectXml, getCreatableType } from '../../src/abap_cli/clients/create-object.js';

describe('clients/create-object (BTP-safe CLAS/INTF/PROG/FUGR wrapper)', () => {
  describe('getCreatableType', () => {
    it('maps CLAS/INTF/PROG/FUGR to entries; falls through for the rest', () => {
      expect(getCreatableType('CLAS')).toBeDefined();
      expect(getCreatableType('INTF')).toBeDefined();
      expect(getCreatableType('PROG')).toBeDefined();
      expect(getCreatableType('FUGR')).toBeDefined();
      expect(getCreatableType('DDLS')).toBeUndefined();
      expect(getCreatableType('TABL')).toBeUndefined();
      expect(getCreatableType('DEVC')).toBeUndefined();
    });
  });

  describe('createObjectXml', () => {
    it('POSTs CLAS body with BTP-mandatory elements (testclasses include + superClassRef + v4 media type)', async () => {
      const http = { request: vi.fn(async () => ({ body: '', status: 200, statusText: 'OK', headers: {} })) } as unknown as Parameters<typeof createObjectXml>[0];
      await createObjectXml(http, {
        objtype: 'CLAS',
        name: 'ZCLI_TC_X',
        parentName: '$tmp',
        description: 'test',
        parentPath: '/sap/bc/adt/packages/$tmp',
        transport: 'TRLK900016',
      }, { responsible: 'TESTER' });
      const call = (http.request as ReturnType<typeof vi.fn>).mock.calls[0]!;
      // CLAS URL is /sap/bc/adt/oo/classes — the package is in the body, not the URL.
      expect(call[0]).toBe('/sap/bc/adt/oo/classes');
      expect(call[1]).toMatchObject({
        method: 'POST',
        qs: { corrNr: 'TRLK900016' },
      });
      // Default Content-Type is the v4 vendor media-type (BTP trial ST accepts
      // this; on-prem tolerates it). NOT `application/*` (BTP ST rejects).
      expect(call[1].headers['Content-Type']).toBe(
        'application/vnd.sap.adt.oo.classes.v4+xml',
      );
      expect(call[1].headers.Accept).toBe('application/xml');
      // Body shape (fr0ster trial-safe envelope):
      //   - xmlns:abapsource namespace declared
      //   - <adtcore:packageRef adtcore:uri="..."/> (BTP ST validates uri)
      //   - <class:include class:includeType="testclasses"/> (BTP-mandatory)
      //   - <class:superClassRef/> (BTP-mandatory empty element)
      expect(call[1].body).toContain('<class:abapClass');
      expect(call[1].body).toContain('xmlns:abapsource="http://www.sap.com/adt/abapsource"');
      expect(call[1].body).toContain('adtcore:name="ZCLI_TC_X"');
      expect(call[1].body).toContain('adtcore:type="CLAS"');
      // responsible deliberately omitted (BTP trial ST rejects it).
      expect(call[1].body).not.toContain('adtcore:responsible=');
      expect(call[1].body).toMatch(/<adtcore:packageRef adtcore:name="\$tmp" adtcore:uri="\/sap\/bc\/adt\/packages\/[^"]+"\/>/);
      expect(call[1].body).toContain('class:includeType="testclasses"');
      expect(call[1].body).toContain('<class:superClassRef/>');
    });

    it('does NOT emit the BTP-mandatory extras on INTF (only CLAS needs testclasses+superClassRef)', async () => {
      const http = { request: vi.fn(async () => ({ body: '', status: 200, statusText: 'OK', headers: {} })) } as unknown as Parameters<typeof createObjectXml>[0];
      await createObjectXml(http, {
        objtype: 'INTF',
        name: 'ZIF_X',
        parentName: '$tmp',
        description: 'x',
        parentPath: '/sap/bc/adt/packages/$tmp',
      }, { responsible: 'X' });
      const body = (http.request as ReturnType<typeof vi.fn>).mock.calls[0]![1].body;
      expect(body).toContain('<intf:abapInterface');
      expect(body).toContain('xmlns:abapsource');
      expect(body).not.toContain('class:includeType');
      expect(body).not.toContain('class:superClassRef');
    });

    it('honours language / masterLanguage overrides', async () => {
      const http = { request: vi.fn(async () => ({ body: '', status: 200, statusText: 'OK', headers: {} })) } as unknown as Parameters<typeof createObjectXml>[0];
      await createObjectXml(http, {
        objtype: 'INTF',
        name: 'ZIF_X',
        parentName: '$tmp',
        description: 'test',
        parentPath: '/sap/bc/adt/packages/$tmp',
        language: 'DE',
        masterLanguage: 'EN',
      }, { responsible: 'TESTER' });
      const body = (http.request as ReturnType<typeof vi.fn>).mock.calls[0]![1].body;
      expect(body).toContain('adtcore:language="DE"');
      expect(body).toContain('adtcore:masterLanguage="EN"');
      expect(body).toContain('<intf:abapInterface');
      expect((http.request as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('/sap/bc/adt/oo/interfaces');
    });

    it('XML-escapes description / name to prevent injection', async () => {
      const http = { request: vi.fn(async () => ({ body: '', status: 200, statusText: 'OK', headers: {} })) } as unknown as Parameters<typeof createObjectXml>[0];
      await createObjectXml(http, {
        objtype: 'PROG',
        name: 'ZPROG_X',
        parentName: '$tmp',
        description: 'evil "><script>',
        parentPath: '/sap/bc/adt/packages/$tmp',
      }, { responsible: 'A&B' });
      const body = (http.request as ReturnType<typeof vi.fn>).mock.calls[0]![1].body;
      // The literal "<script>" tag must not appear unescaped in any attribute.
      expect(body).not.toContain('" evil '); // would happen without escaping
      expect(body).toContain('&lt;script&gt;');
      expect(body).toContain('&quot;');
      // adtcore:responsible is deliberately omitted (BTP trial ST rejects it).
      expect(body).not.toContain('adtcore:responsible=');
    });

    it('throws TYPE_NOT_SUPPORTED for unsupported objtype (caller must fall back)', async () => {
      const http = { request: vi.fn() } as unknown as Parameters<typeof createObjectXml>[0];
      await expect(createObjectXml(http, {
        objtype: 'TABL',
        name: 'ZT',
        parentName: '$tmp',
        description: 'x',
        parentPath: '/p',
      }, { responsible: 'X' })).rejects.toMatchObject({
        code: 'TYPE_NOT_SUPPORTED',
        message: expect.stringContaining("unsupported objtype 'TABL'"),
      });
      expect(http.request).not.toHaveBeenCalled();
    });

    it('omits corrNr qs when transport is absent', async () => {
      const http = { request: vi.fn(async () => ({ body: '', status: 200, statusText: 'OK', headers: {} })) } as unknown as Parameters<typeof createObjectXml>[0];
      await createObjectXml(http, {
        objtype: 'CLAS',
        name: 'Z',
        parentName: '$tmp',
        description: 'x',
        parentPath: '/p',
      }, { responsible: 'X' });
      expect((http.request as ReturnType<typeof vi.fn>).mock.calls[0]![1].qs).toEqual({});
    });

    it('honours opts.contentType override', async () => {
      const http = { request: vi.fn(async () => ({ body: '', status: 200, statusText: 'OK', headers: {} })) } as unknown as Parameters<typeof createObjectXml>[0];
      await createObjectXml(http, {
        objtype: 'CLAS',
        name: 'Z',
        parentName: '$tmp',
        description: 'x',
        parentPath: '/p',
      }, { responsible: 'X' }, { contentType: 'application/vnd.sap-adt.oo.classes+xml' });
      expect((http.request as ReturnType<typeof vi.fn>).mock.calls[0]![1].headers['Content-Type']).toBe('application/vnd.sap-adt.oo.classes+xml');
    });
  });
});