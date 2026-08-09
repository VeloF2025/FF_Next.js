import { describe, expect, it, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { ZoneHandoverButton } from '../ZoneHandoverButton';
/**
 * Reading rowVersion off the wrong level of the document route's envelope
 * shipped a broken handover: the second upload sent expectedRowVersion
 * undefined and was rejected, so no zone could ever get its second document.
 *
 * The guard is the `uploaded()` fixture below, which nests the zone exactly as
 * the route does. It is a RUNTIME guard: reverting the client makes the
 * asserted expectedRowVersion come back undefined and the test fails.
 *
 * There is deliberately no type-level guard tying this fixture to the server's
 * return type. tsconfig.json excludes test and __tests__ files entirely, so
 * nothing declared here is ever type-checked — an alias resolving
 * storeZoneDeliveryDocument's return shape would look like protection and catch
 * nothing. If the route's shape changes, this fixture is what has to be
 * updated, and the assertion below is what will notice.
 */

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

/** GET /zone and POST /zone return the zone view directly. */
const view = (rowVersion: number, documents: unknown[] = []) => ({
  ok: true,
  json: async () => ({ success: true, data: { rowVersion, documents } }),
});

/** POST /document returns { zone, document } — a different shape. */
const uploaded = (rowVersion: number) => ({
  ok: true,
  json: async () => ({
    success: true,
    data: {
      zone: { rowVersion, documents: [] },
      document: { sourceRef: '/storage/x.pdf' },
    },
  }),
});

/**
 * open (pre-flight read) -> 0, GET zone -> 0, FAC -> 1, CAC -> 2, declare -> 3.
 * The pre-flight read is what tells the dialog whether evidence already exists.
 */
const happyPath = () => {
  fetchMock
    .mockResolvedValueOnce(view(0))       // dialog opens: pre-flight read
    .mockResolvedValueOnce(view(0))       // submit: current row version
    .mockResolvedValueOnce(uploaded(1))   // FAC  -> { zone, document }
    .mockResolvedValueOnce(uploaded(2))   // CAC  -> { zone, document }
    .mockResolvedValueOnce(view(3));      // declare handover
};

const openWithFiles = () => {
  render(<ZoneHandoverButton projectId="p-1" zoneNo={20} />);
  fireEvent.click(screen.getByRole('button', { name: /Zone Handover/ }));
  // Drop the pre-flight read so the assertions below index the write sequence.
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const [, read, facCall, cacCall, declare] = fetchMock.mock.calls;

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
    const notFound = { ok: false, json: async () => ({ success: false, error: { message: 'Zone has no canonical PON tracking rows' } }) };
    fetchMock
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce(uploaded(1))
      .mockResolvedValueOnce(uploaded(2))
      .mockResolvedValueOnce(view(3));
    openWithFiles();
    submit();
    await settle();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect((fetchMock.mock.calls[2]![1].body as FormData).get('expectedRowVersion')).toBe('0');
  });

  it('stops at the failing step and reports it', async () => {
    fetchMock
      .mockResolvedValueOnce(view(0))
      .mockResolvedValueOnce(view(0))
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: { message: 'Document metadata or owner is invalid' } }) });
    openWithFiles();
    submit();
    await settle();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Document metadata'));
    // The CAC upload and the declaration must not run after the FAC failed.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses to start without both documents', async () => {
    fetchMock.mockResolvedValue(view(0));
    render(<ZoneHandoverButton projectId="p-1" zoneNo={20} />);
    fireEvent.click(screen.getByRole('button', { name: /Zone Handover/ }));
    submit();
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('Both the FAC and the CAC are required');
    // The pre-flight read is allowed; nothing may be written.
    const wrote = fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes('/document') || (init as RequestInit | undefined)?.method === 'POST');
    expect(wrote).toBe(false);
  });

  it('asks for a reason up front when evidence is already on file', async () => {
    // Re-running a half-finished handover supersedes the document it already
    // uploaded, which the command treats as a correction and rejects without a
    // reason. Today's date alone would not surface the field.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rowVersion: 3,
          documents: [{ documentType: 'fac', active: true }],
        },
      }),
    });
    render(<ZoneHandoverButton projectId="p-1" zoneNo={20} />);
    fireEvent.click(screen.getByRole('button', { name: /Zone Handover/ }));
    await settle();

    const reason = screen.getByLabelText('Reason for replacing the evidence on file');
    expect(reason).toBeRequired();
  });

  it('does not ask for a reason on a zone with no evidence yet', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { rowVersion: 0, documents: [] } }),
    });
    render(<ZoneHandoverButton projectId="p-1" zoneNo={20} />);
    fireEvent.click(screen.getByRole('button', { name: /Zone Handover/ }));
    await settle();

    expect(screen.queryByLabelText(/^Reason/)).not.toBeInTheDocument();
  });
});
