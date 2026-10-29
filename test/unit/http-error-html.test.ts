/**
 * F-29: SAP answers with an HTML error page (ICM 503, ABAP dump, session
 * timeout) instead of the usual JSON/XML envelope. Before this fix the whole
 * page — up to 9 KB of `<!DOCTYPE html>`, inline CSS and a base64 logo — was
 * put into `error.message`. `extractExcMessage` now reduces an HTML body to
 * its `msgText` / `errorTextHeader` line and marks the body kind, while the
 * full (truncated) page stays in `details.sapErrorBody` for debugging.
 */
import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import {
  classifyHttpError,
  summarizeHtmlErrorPage,
} from '../../src/abap_cli/clients/http-error.js';

/** Realistic ICM 503 page: inline CSS + a data-URI base64 logo + the two
 *  spans SAP uses for the human-readable banner and message. */
const ICM_503_PAGE = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
<head>
<meta http-equiv="content-type" content="text/html; charset=utf-8">
<title>Service Not Available</title>
<style type="text/css">
body { font-family: Arial, sans-serif; }
.errorTextHeader { color: #bb0000; font-size: 18px; }
</style>
</head>
<body>
<div class="header">
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" alt="SAP">
<span class="errorTextHeader">503 Service Not Available</span>
</div>
<p id="msgText">The service is temporarily not available. Please try again later.</p>
</body>
</html>`;

/** Realistic ABAP short-dump page; the only useful line is msgText. */
const ABAP_DUMP_PAGE = `<!DOCTYPE html>
<html>
<head><title>Runtime Error</title></head>
<body>
<h1>Internal Server Error</h1>
<span id="msgText">Error in an ABAP statement: &lt;ZCL_FOO&gt;=&gt;MAIN. The exception CX_SY_ZERODIVIDE was raised.</span>
<p>Short dump written to ST22.</p>
</body>
</html>`;

function ax(status: number, statusText: string, data: unknown): AxiosError {
  return new AxiosError('Request failed', String(status), undefined, undefined, {
    status,
    statusText,
    data,
    headers: {},
    config: undefined as never,
  });
}

/** abap-adt-api wraps the AxiosError into an HttpClientException carrying the
 *  SAP response body on `.response.body` (walked by the classifier). */
function wrappedClientException(status: number, body: string): Error & { status: number; response: { body: string } } {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    status,
    response: { body },
  });
}

describe('F-29 — HTML error pages are summarised, not dumped', () => {
  it('reduces an ICM 503 page to a short message carrying the status text', () => {
    const cli = classifyHttpError(ax(503, 'Service Unavailable', ICM_503_PAGE));

    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.message).toContain('503 Service Not Available');
    // The whole point of F-29: no raw page, no embedded assets in the message.
    expect(cli.message).not.toMatch(/<!DOCTYPE html/i);
    expect(cli.message).not.toContain('base64');
    expect(cli.message.length).toBeLessThan(300);

    // The full body is still available (truncated as before) for debugging.
    expect(cli.details?.errorKind).toBe('html');
    expect(cli.details?.sapErrorBody).toContain('<!DOCTYPE');
    expect(cli.details?.httpStatus).toBe(503);
  });

  it('extracts the msgText line from an ABAP dump page (wrapped exception path)', () => {
    const cli = classifyHttpError(wrappedClientException(500, ABAP_DUMP_PAGE));

    expect(cli.code).toBe('SAP_ERROR');
    expect(cli.message).toContain('Error in an ABAP statement');
    // Basic entities are decoded so the ABAP source line is readable.
    expect(cli.message).toContain('<ZCL_FOO>=>MAIN');
    expect(cli.message).not.toMatch(/<!DOCTYPE html/i);
    expect(cli.details?.errorKind).toBe('html');
    expect(cli.details?.sapErrorBody).toContain('<!DOCTYPE');
  });

  it('keeps the XML <message lang="EN"> extraction unchanged', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <message lang="EN">Resource ZCL_FOO does not exist</message>
</exc:exception>`;
    const cli = classifyHttpError(ax(404, 'Not Found', xml));

    expect(cli.message).toBe('Resource ZCL_FOO does not exist');
    expect(cli.details?.errorKind).toBe('xml');
    expect(cli.details?.sapErrorBody).toContain('<message lang="EN">');
  });

  it('keeps the plain-text body behaviour unchanged', () => {
    const text = 'Something went wrong on the SAP side';
    const cli = classifyHttpError(ax(500, 'Internal Server Error', text));

    expect(cli.message).toBe(text);
    expect(cli.details?.errorKind).toBe('text');
    expect(cli.details?.sapErrorBody).toBe(text);
  });

  it('falls back to the HTTP status line when an HTML page has no recognisable text', () => {
    const page = '<!DOCTYPE html><html><body><p>no spans here</p></body></html>';
    const cli = classifyHttpError(ax(503, 'Service Unavailable', page));

    expect(cli.message).toBe('HTTP 503 Service Unavailable');
    expect(cli.message).not.toContain('no spans here');
    expect(cli.details?.errorKind).toBe('html');
  });

  it('falls back to a byte-count placeholder when neither text nor status is known', () => {
    const page = '<!DOCTYPE html><html><body><p>no spans here</p></body></html>';
    const message = summarizeHtmlErrorPage(page);

    expect(message).toMatch(/^HTML error page \(\d+ bytes\) from SAP$/);
    expect(message).not.toContain('<!DOCTYPE');
  });
});
