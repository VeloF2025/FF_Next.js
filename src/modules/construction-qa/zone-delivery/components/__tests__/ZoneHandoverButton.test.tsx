import { describe, expect, it, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { ZoneHandoverButton } from '../ZoneHandoverButton';

const can = vi.fn();
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can }) }));

const fetchMock = vi.fn();

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const view = (rowVersion: number) => ({
  ok: true,
  json: async () => ({ success: true, data: { rowVersion } }),
});

/** GET zone -> 0, FAC upload -> 1, CAC upload -> 2, declare -> 3. */
const happyPath = () => {
  fetchMock
    .mockResolvedValueOnce(view(0))
    .mockResolvedValueOnce(view(1))
    .mockResolvedValueOnce(view(2))
    .mockResolvedValueOnce(view(3));
};

const openWithFiles = () => {
  render(<ZoneHandoverButton projectId="p-1" zoneNo={20} />);
  fireEvent.click(screen.getByRole('button', { name: /Zone Handover/ }));
  fireEvent.change(screen.getByLabelText('FAC'), {
    target: { files: [new File(['fac'], 'fac.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(screen.getByLabelText('CAC'), {
    target: { files: [new File(['cac'], 'cac.pdf', { type: 'application/pdf' })] },
  });
};

const submit = () => fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);

beforeEach(() => {
  can.mockReset().mockReturnValue(true);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('ZoneHandoverButton', () => {
  it('is hidden unless the user can both approve the zone and manage documents', () => {
    can.mockImplementation((key: string) => key !== 'construction-qa.zone-delivery.documents-manage');
    render(<ZoneHandoverButton projectId="p-1" zoneNo={20} />);
    expect(screen.queryByRole('button', { name: /Zone Handover/ })).not.toBeInTheDocument();
  });

  it('uploads both documents then declares the date, carrying the row version forward', async () => {
    happyPath();
    openWithFiles();
    submit();
    await settle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [read, facCall, cacCall, declare] = fetchMock.mock.calls;

    expect(String(read![0])).toContain('/api/zone-delivery/zone?');
    // Each document registration bumps the zone's version, so the next request
    // must use the version its predecessor returned, not the one read up front.
    expect(String(facCall![0])).toBe('/api/zone-delivery/document');
    expect((facCall![1].body as FormData).get('expectedRowVersion')).toBe('0');
    expect((facCall![1].body as FormData).get('documentType')).toBe('fac');
    expect((cacCall![1].body as FormData).get('expectedRowVersion')).toBe('1');
    expect((cacCall![1].body as FormData).get('documentType')).toBe('cac');

    expect(String(declare![0])).toBe('/api/zone-delivery/zone');
    expect(JSON.parse(String(declare![1].body))).toMatchObject({
      projectId: 'p-1', zoneNo: 20, expectedRowVersion: 2, source: 'works-qa-toolbar',
    });
  });

  it('treats an unreadable zone as version 0 rather than failing up front', async () => {
    // A zone with no canonical PON rows cannot be read at all; the upload that
    // follows is what creates them.
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: { message: 'Zone has no canonical PON tracking rows' } }) })
      .mockResolvedValueOnce(view(1))
      .mockResolvedValueOnce(view(2))
      .mockResolvedValueOnce(view(3));
    openWithFiles();
    submit();
    await settle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect((fetchMock.mock.calls[1]![1].body as FormData).get('expectedRowVersion')).toBe('0');
  });

  it('stops at the failing step and reports it', async () => {
    fetchMock
      .mockResolvedValueOnce(view(0))
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: { message: 'Document metadata or owner is invalid' } }) });
    openWithFiles();
    submit();
    await settle();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Document metadata'));
    // The CAC upload and the declaration must not run after the FAC failed.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses to start without both documents', async () => {
    render(<ZoneHandoverButton projectId="p-1" zoneNo={20} />);
    fireEvent.click(screen.getByRole('button', { name: /Zone Handover/ }));
    submit();
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('Both the FAC and the CAC are required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
