import { renderHook } from '@testing-library/react';

const swrSpy = vi.fn(() => ({ data: [], error: undefined, mutate: vi.fn(), isLoading: false }));
vi.mock('swr', () => ({ __esModule: true, default: (...args: unknown[]) => swrSpy(...args) }));

import { usePoleList } from '../usePoleList';

const lastKey = () => String(swrSpy.mock.calls.at(-1)?.[0] ?? '');

describe('usePoleList — request URL', () => {
  beforeEach(() => swrSpy.mockClear());

  it('includes zone_no when a zone is selected (no PON)', () => {
    renderHook(() => usePoleList('p1', 13, null));
    const url = lastKey();
    expect(url).toContain('project_id=p1');
    expect(url).toContain('zone_no=13');
    expect(url).not.toContain('pon_no');
  });

  it('includes both zone_no and pon_no when both are selected', () => {
    renderHook(() => usePoleList('p1', 13, 223));
    const url = lastKey();
    expect(url).toContain('zone_no=13');
    expect(url).toContain('pon_no=223');
  });

  it('omits zone_no when no zone is selected (project-wide)', () => {
    renderHook(() => usePoleList('p1', null, null));
    const url = lastKey();
    expect(url).toContain('project_id=p1');
    expect(url).not.toContain('zone_no');
  });

  it('passes a null SWR key (no fetch) when there is no project', () => {
    renderHook(() => usePoleList(null, 13, null));
    expect(swrSpy.mock.calls.at(-1)?.[0]).toBeNull();
  });
});
