import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { log } from '@/lib/logger';
import { useSiteCamPhotos } from '../useSiteCamPhotos';

function mockFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body });
}

describe('useSiteCamPhotos', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('maps a submission into step-sorted photos with metadata', async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        submission: {
          submittedAt: '2026-07-14T13:27:47Z',
          techName: 'Test Tech',
          photoCount: 3,
          // Deliberately out of order to prove sorting.
          photoUrls: {
            10: '/storage/sitecam/photos/c-sign.jpg',
            1: '/storage/sitecam/photos/a-house.jpg',
            2: '/storage/sitecam/photos/b-pole.jpg',
          },
        },
      },
    });

    const { result } = renderHook(() => useSiteCamPhotos('DR2600734'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.count).toBe(3);
    expect(result.current.techName).toBe('Test Tech');
    expect(result.current.photos.map((p) => p.step)).toEqual([1, 2, 10]);
    expect(result.current.photos[0]).toMatchObject({
      step: 1,
      url: '/storage/sitecam/photos/a-house.jpg',
      filename: 'a-house.jpg',
    });
  });

  it('shows the empty state (no error) when the DR has no submission', async () => {
    global.fetch = mockFetch({ success: true, data: { submission: null } });

    const { result } = renderHook(() => useSiteCamPhotos('DR0000000'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.photos).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.error).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('surfaces an error (and logs) when the API returns success:false', async () => {
    global.fetch = mockFetch({ success: false, error: { message: 'Unauthorized' } }, false);

    const { result } = renderHook(() => useSiteCamPhotos('DR2600734'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to load SiteCam photos');
    expect(result.current.photos).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });

  it('surfaces an error (and logs) when the fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useSiteCamPhotos('DR2600734'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to load SiteCam photos');
    expect(log.warn).toHaveBeenCalled();
  });
});
