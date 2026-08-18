import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSelfieHref } from '../../openAuditedSelfie';
import { SelfieCell } from '../SelfieCell';
import { ReportTable } from '../ReportTable';
import type { ReportColumn } from '@/services/attendance/reports/types';

// Without this React logs "not configured to support act(...)" and state
// updates may not flush, which would let the error-message assertions below
// pass or fail for reasons unrelated to the component.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HREF = '/api/staff/attendance-selfie?entryId=06847d2d-c02e-4998-8985-f5af1acbd597&kind=in&context=checkin-locations';

describe('parseSelfieHref', () => {
  it('recovers the entry id and kind from an audited path', () => {
    expect(parseSelfieHref(HREF)).toEqual({
      entryId: '06847d2d-c02e-4998-8985-f5af1acbd597', kind: 'in',
    });
  });

  it('recovers kind=out distinctly', () => {
    expect(parseSelfieHref(HREF.replace('kind=in', 'kind=out'))?.kind).toBe('out');
  });

  it.each(['', 'not a url', '/api/staff/attendance-selfie?entryId=nope&kind=in'])(
    'returns null for %o rather than a dead button', (bad) => {
      expect(parseSelfieHref(bad)).toBeNull();
    });
});

describe('SelfieCell', () => {
  it('renders a button, never an anchor to the JSON route', () => {
    // A plain <a href> to /api/staff/attendance-selfie opens a tab of raw
    // JSON — the route answers with an envelope, not the image. The cell
    // must fetch and unwrap instead.
    const html = renderToStaticMarkup(
      React.createElement(SelfieCell, { href: HREF, context: 'checkin-locations' }),
    );
    expect(html).toContain('<button');
    expect(html).toContain('View');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain(`href="${HREF}"`);
  });

  it('renders no button when the cell is not a usable selfie path', () => {
    const html = renderToStaticMarkup(
      React.createElement(SelfieCell, { href: 'rubbish', context: 'x' }),
    );
    expect(html).not.toContain('<button');
  });
});

describe('ReportTable selfie_link wiring', () => {
  const columns: ReadonlyArray<ReportColumn> = [
    { key: 'selfie', label: 'Selfie', format: 'selfie_link' },
  ];

  it('routes a selfie_link column through SelfieCell, not fmtCell', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportTable, { columns, rows: [{ selfie: HREF }], loading: false }),
    );
    expect(html).toContain('<button');
    expect(html).not.toContain(`href="${HREF}"`);
  });

  it('leaves an empty selfie cell inert', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportTable, { columns, rows: [{ selfie: '' }], loading: false }),
    );
    expect(html).not.toContain('<button');
  });
});

describe('SelfieCell interaction', () => {
  let container: HTMLDivElement;
  const openSpy = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    openSpy.mockReset();
    vi.stubGlobal('open', openSpy);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  async function clickView() {
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(SelfieCell, { href: HREF, context: 'checkin-locations' }));
    });
    await act(async () => {
      container.querySelector('button')!.click();
    });
    return root;
  }

  it('fetches the audited route and opens the unwrapped url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { url: '/storage/attendance/x.jpg' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const root = await clickView();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/staff/attendance-selfie?entryId=06847d2d-c02e-4998-8985-f5af1acbd597');
    expect(url).toContain('kind=in');
    // Cookie must ride along or the audited route 401s.
    expect(init.credentials).toBe('include');
    expect(openSpy).toHaveBeenCalledWith('/storage/attendance/x.jpg', '_blank', 'noopener,noreferrer');
    await act(async () => { root.unmount(); });
  });

  it('surfaces the audit-failure reason and opens nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: { details: { reason: 'audit_write_failed' } } }),
    }));

    const root = await clickView();

    expect(container.textContent).toContain('Compliance audit failed');
    expect(openSpy).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });

  it('distinguishes a retention-deleted selfie from an audit failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: { details: { reason: 'unavailable' } } }),
    }));

    const root = await clickView();

    expect(container.textContent).toContain('retention policy');
    expect(container.textContent).not.toContain('Compliance audit failed');
    expect(openSpy).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
});
