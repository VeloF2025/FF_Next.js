import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityFixture,
  ponStageId,
  projectId,
  zoneFixture,
} from '../../components/__tests__/zoneDeliveryWorkspaceFixture';
import { useZoneDeliveryZone } from '../useZoneDeliveryZone';

const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) });
const begin = async () => {
  fetchMock.mockResolvedValueOnce(ok(zoneFixture)).mockResolvedValueOnce(ok(activityFixture));
  const hook = renderHook(() => useZoneDeliveryZone({ projectId, zoneNo: 12 }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};
const finishCommand = () => {
  fetchMock.mockResolvedValueOnce(ok(zoneFixture));
  fetchMock.mockResolvedValueOnce(ok(zoneFixture)).mockResolvedValueOnce(ok(activityFixture));
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('useZoneDeliveryZone command payloads', () => {
  it('submits one complete non-empty scope list with the zone row version', async () => {
    const { result } = await begin();
    finishCommand();
    await act(() => result.current.updateScope({
      pons: [
        { ponStageId, scopeStatus: 'included' },
        {
          ponStageId: '44444444-4444-4444-8444-444444444444',
          scopeStatus: 'excluded',
          reason: 'Wayleave withdrawn',
        },
      ],
      expectedRowVersion: 11,
      effectiveAt: '2026-07-30T08:00:00.000Z',
      source: 'Approved schedule',
      reason: 'Scope correction',
    }));
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      projectId, zoneNo: 12, expectedRowVersion: 11,
      effectiveAt: '2026-07-30T08:00:00.000Z', source: 'Approved schedule',
      reason: 'Scope correction',
      pons: [
        { ponStageId, scopeStatus: 'included' },
        {
          ponStageId: '44444444-4444-4444-8444-444444444444',
          scopeStatus: 'excluded',
          reason: 'Wayleave withdrawn',
        },
      ],
    });
  });

  it('uploads test packs and zone-owned FAC/CAC with exact multipart fields', async () => {
    const { result } = await begin();
    for (const documentType of ['test_pack', 'fac', 'cac'] as const) {
      finishCommand();
      await act(() => result.current.uploadDocument({
        file: new File(['evidence'], `${documentType}.pdf`, { type: 'application/pdf' }),
        documentType,
        ...(documentType === 'test_pack' ? { ponStageId } : {}),
        expectedRowVersion: 11,
        effectiveAt: '2026-07-30T08:00:00.000Z',
        source: 'Signed certificate register',
        reason: 'Historical evidence',
      }));
      const request = fetchMock.mock.calls.at(documentType === 'test_pack' ? 2 : documentType === 'fac' ? 5 : 8);
      const body = (request?.[1] as RequestInit).body as FormData;
      expect(request?.[0]).toBe('/api/zone-delivery/document');
      expect(body.get('file')).toBeInstanceOf(File);
      expect(Object.fromEntries(body.entries())).toMatchObject({
        projectId,
        zoneNo: '12',
        expectedRowVersion: '11',
        effectiveAt: '2026-07-30T08:00:00.000Z',
        source: 'Signed certificate register',
        reason: 'Historical evidence',
        documentType,
      });
      expect(body.get('ponStageId')).toBe(documentType === 'test_pack' ? ponStageId : null);
    }
  });
});
