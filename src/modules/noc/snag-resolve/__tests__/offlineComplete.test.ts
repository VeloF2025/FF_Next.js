import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitCompleteStep } from '../offlineComplete';

afterEach(() => vi.restoreAllMocks());

describe('submitCompleteStep', () => {
  it('POSTs the complete_step action to the shared token endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await submitCompleteStep({ token: 'tok', stepId: 's1', actorId: 'a1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/snags/shared/tok', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'complete_step', stepId: 's1', actorId: 'a1' });
  });

  it('throws with a numeric .status on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 409 })));
    await expect(submitCompleteStep({ token: 'tok', stepId: 's1' })).rejects.toMatchObject({ status: 409 });
  });
});
