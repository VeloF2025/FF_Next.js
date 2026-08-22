import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  waBridgeAuthHeaders,
  waBridgeJsonHeaders,
  __resetWaBridgeAuthWarning,
} from './waBridgeAuth';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { log } from '@/lib/logger';

const ORIGINAL = process.env.WA_BRIDGE_SECRET;

describe('waBridgeAuthHeaders', () => {
  beforeEach(() => {
    __resetWaBridgeAuthWarning();
    vi.mocked(log.warn).mockClear();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WA_BRIDGE_SECRET;
    else process.env.WA_BRIDGE_SECRET = ORIGINAL;
  });

  it('sends the secret under the header the bridge reads', () => {
    process.env.WA_BRIDGE_SECRET = 'sekrit';
    expect(waBridgeAuthHeaders()).toEqual({ 'x-bridge-secret': 'sekrit' });
  });

  it('omits the header rather than sending an empty one when unset', () => {
    delete process.env.WA_BRIDGE_SECRET;
    const headers = waBridgeAuthHeaders();
    // An empty x-bridge-secret would be indistinguishable from a wrong secret
    // and would fail closed once the bridge enforces; absent is the honest shape.
    expect(headers).toEqual({});
    expect('x-bridge-secret' in headers).toBe(false);
  });

  it('treats an empty-string secret as unset', () => {
    process.env.WA_BRIDGE_SECRET = '';
    expect(waBridgeAuthHeaders()).toEqual({});
  });

  it('warns once, not on every call, when the secret is missing', () => {
    delete process.env.WA_BRIDGE_SECRET;
    waBridgeAuthHeaders();
    waBridgeAuthHeaders();
    waBridgeAuthHeaders();
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
  });

  it('does not warn when the secret is present', () => {
    process.env.WA_BRIDGE_SECRET = 'sekrit';
    waBridgeAuthHeaders();
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled();
  });

  it('reads the secret per call so a late-loaded env is picked up', () => {
    delete process.env.WA_BRIDGE_SECRET;
    expect(waBridgeAuthHeaders()).toEqual({});
    process.env.WA_BRIDGE_SECRET = 'arrived-later';
    expect(waBridgeAuthHeaders()).toEqual({ 'x-bridge-secret': 'arrived-later' });
  });
});

describe('waBridgeJsonHeaders', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WA_BRIDGE_SECRET;
    else process.env.WA_BRIDGE_SECRET = ORIGINAL;
  });

  it('keeps the JSON content type alongside the secret', () => {
    process.env.WA_BRIDGE_SECRET = 'sekrit';
    expect(waBridgeJsonHeaders()).toEqual({
      'Content-Type': 'application/json',
      'x-bridge-secret': 'sekrit',
    });
  });

  it('still sets the content type when the secret is unset', () => {
    __resetWaBridgeAuthWarning();
    delete process.env.WA_BRIDGE_SECRET;
    // Dropping Content-Type would break every bridge POST body parse.
    expect(waBridgeJsonHeaders()).toEqual({ 'Content-Type': 'application/json' });
  });
});
