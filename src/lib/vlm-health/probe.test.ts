import { describe, it, expect, vi } from 'vitest';
import { probeVlmHealth, STARTUP_GRACE_MS } from './probe';

function fakeFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    ...response,
  }) as unknown as typeof fetch;
}

describe('probeVlmHealth', () => {
  it('returns the first model id on success', async () => {
    const fetchImpl = fakeFetch({ json: async () => ({ data: [{ id: 'Qwen3-VL' }] }) });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: () => null });
    expect(result.modelId).toBe('Qwen3-VL');
    expect(result.withinStartupGrace).toBe(false);
    expect(result.failureReason).toBeNull();
  });

  it('treats an HTTP error as unreachable', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 503 });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: () => null });
    expect(result.modelId).toBeNull();
    expect(result.failureReason).toContain('503');
  });

  it('treats an empty model list as unreachable, not a healthy default', async () => {
    const fetchImpl = fakeFetch({ json: async () => ({ data: [] }) });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: () => null });
    expect(result.modelId).toBeNull();
  });

  it('treats a fetch rejection (connection refused, timeout) as unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: () => null });
    expect(result.modelId).toBeNull();
    expect(result.failureReason).toBe('fetch failed');
  });

  it('marks a failure within the startup grace window so callers do not page on it', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeVlmHealth({
      fetchImpl,
      serviceUptimeMs: () => STARTUP_GRACE_MS - 1000,
    });
    expect(result.withinStartupGrace).toBe(true);
  });

  it('does not grant grace once the service has been up longer than the window', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeVlmHealth({
      fetchImpl,
      serviceUptimeMs: () => STARTUP_GRACE_MS + 1000,
    });
    expect(result.withinStartupGrace).toBe(false);
  });

  it('does not grant grace when uptime cannot be determined', async () => {
    // This is the honest default: an unknown uptime must not silently suppress
    // a real, sustained outage the way the 2026-08-20 incident did.
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: () => null });
    expect(result.withinStartupGrace).toBe(false);
  });

  it('does not report withinStartupGrace on a successful probe', async () => {
    const fetchImpl = fakeFetch({ json: async () => ({ data: [{ id: 'Qwen3-VL' }] }) });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: () => 1000 });
    expect(result.withinStartupGrace).toBe(false);
  });
});
