/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearMyPortalSessionCache } from '../serviceWorkerSessionCache';

afterEach(() => vi.unstubAllGlobals());

describe('clearMyPortalSessionCache', () => {
  it('targets the active /my worker and waits for its cache-cleared acknowledgement', async () => {
    const port1 = { onmessage: null as null | ((event: MessageEvent) => void), close: vi.fn() };
    const port2 = { close: vi.fn() };
    vi.stubGlobal('MessageChannel', vi.fn(() => ({ port1, port2 })));
    const rootPost = vi.fn();
    const myPost = vi.fn((_message, transfer: MessagePort[]) => {
      expect(transfer).toEqual([port2]);
      port1.onmessage?.({ data: { type: 'SESSION_CACHE_CLEARED' } } as MessageEvent);
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: { scriptURL: '/sw-app.js', postMessage: rootPost },
        getRegistration: vi.fn(async () => ({ active: { postMessage: myPost } })),
      },
    });

    await expect(clearMyPortalSessionCache()).resolves.toBe(true);
    expect(myPost).toHaveBeenCalledWith(
      { type: 'CLEAR_SESSION_CACHE' },
      [port2],
    );
    expect(rootPost).not.toHaveBeenCalled();
    expect(port1.close).toHaveBeenCalled();
  });
});
