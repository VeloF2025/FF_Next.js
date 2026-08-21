import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageDeletionValidationError, deleteIncidentStorageObject } from '../storageDeletion';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('approved programme paths', () => {
  it('deletes a raw Fleet incident storage key', async () => {
    const outcome = await deleteIncidentStorageObject('fleet/incidents/abc123_photo.jpg');
    expect(outcome).toBe('deleted');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/delete\/fleet\/incidents\/abc123_photo\.jpg$/);
    expect(init).toMatchObject({ method: 'DELETE' });
  });

  it('accepts the same-origin proxy path stored on the evidence row', async () => {
    await deleteIncidentStorageObject('/storage/fleet/incidents/abc123_photo.jpg');
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/delete\/fleet\/incidents\/abc123_photo\.jpg$/);
  });

  it('accepts an absolute URL on an approved VF Storage host', async () => {
    await deleteIncidentStorageObject('https://vf.fibreflow.app/storage/fleet/incidents/abc123_photo.jpg');
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/delete\/fleet\/incidents\/abc123_photo\.jpg$/);
  });

  // A hung VF Storage would otherwise stall the run indefinitely while holding
  // the cron advisory lock, which blocks every later tick too.
  it('bounds every request with an abort signal', async () => {
    await deleteIncidentStorageObject('fleet/incidents/abc123_photo.jpg');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats an object that is already gone as success so a retry can finish', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    expect(await deleteIncidentStorageObject('fleet/incidents/abc123_photo.jpg')).toBe('already_absent');
  });

  // Failure-safe: a storage error must reach the caller so the database
  // evidence is KEPT for retry. Swallowing it would lose the audit trail.
  it('throws on any other storage failure rather than reporting success', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(deleteIncidentStorageObject('fleet/incidents/abc123_photo.jpg')).rejects.toThrow(/HTTP 500/);
  });

  it('propagates a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(deleteIncidentStorageObject('fleet/incidents/abc123_photo.jpg')).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('paths the purge may never reach', () => {
  // The bound is a SHAPE, not a denylist: anything that is not exactly one
  // safe filename under fleet/incidents is refused, so no encoding trick has
  // to be enumerated. Retention deletes programme-owned Fleet incident
  // attachments and nothing else — H&S, staff documents, pole photos and
  // every other module's files are out of reach by construction.
  it.each([
    ['another module', 'staff/documents/contract.pdf'],
    ['H&S evidence', 'hs/attachments/incident.pdf'],
    ['a sibling fleet category', 'fleet/check-in/vehicle-1/odometer.jpg'],
    ['traversal', 'fleet/incidents/../../staff/documents/contract.pdf'],
    ['encoded traversal', 'fleet/incidents/%2e%2e%2f%2e%2e%2fstaff/documents/contract.pdf'],
    ['a nested extra segment', 'fleet/incidents/sub/dir/photo.jpg'],
    ['a query string', 'fleet/incidents/photo.jpg?all=true'],
    ['a fragment', 'fleet/incidents/photo.jpg#x'],
    ['a wildcard', 'fleet/incidents/*'],
    ['an empty filename', 'fleet/incidents/'],
    ['a bare category', 'fleet/incidents'],
    ['a backslash segment', 'fleet\\incidents\\photo.jpg'],
    ['an unapproved host', 'https://evil.example.com/storage/fleet/incidents/photo.jpg'],
    ['a host that merely ends with an approved one', 'https://evilvf.fibreflow.app/storage/fleet/incidents/p.jpg'],
    ['a host that merely starts with an approved one', 'https://vf.fibreflow.app.evil.example.com/storage/fleet/incidents/p.jpg'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['an empty string', ''],
  ])('refuses %s and issues no DELETE', async (_label, path) => {
    await expect(deleteIncidentStorageObject(path)).rejects.toBeInstanceOf(StorageDeletionValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a non-string path', async () => {
    await expect(deleteIncidentStorageObject(undefined as unknown as string))
      .rejects.toBeInstanceOf(StorageDeletionValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
