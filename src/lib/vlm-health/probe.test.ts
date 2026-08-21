import { describe, it, expect, vi, afterEach } from 'vitest';
import { probeVlmHealth, STARTUP_GRACE_MS } from './probe';

function fakeFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    ...response,
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.doUnmock('child_process');
  vi.resetModules();
});

describe('probeVlmHealth', () => {
  it('returns the first model id on success', async () => {
    const fetchImpl = fakeFetch({ json: async () => ({ data: [{ id: 'Qwen3-VL' }] }) });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: async () => null });
    expect(result.modelId).toBe('Qwen3-VL');
    expect(result.withinStartupGrace).toBe(false);
    expect(result.failureReason).toBeNull();
  });

  it('treats an HTTP error as unreachable', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 503 });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: async () => null });
    expect(result.modelId).toBeNull();
    expect(result.failureReason).toContain('503');
  });

  it('treats an empty model list as unreachable, not a healthy default', async () => {
    const fetchImpl = fakeFetch({ json: async () => ({ data: [] }) });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: async () => null });
    expect(result.modelId).toBeNull();
  });

  it('treats a fetch rejection (connection refused, timeout) as unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: async () => null });
    expect(result.modelId).toBeNull();
    expect(result.failureReason).toBe('fetch failed');
  });

  it('marks a failure within the startup grace window so callers do not page on it', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeVlmHealth({
      fetchImpl,
      serviceUptimeMs: async () => STARTUP_GRACE_MS - 1000,
    });
    expect(result.withinStartupGrace).toBe(true);
  });

  it('does not grant grace once the service has been up longer than the window', async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeVlmHealth({
      fetchImpl,
      serviceUptimeMs: async () => STARTUP_GRACE_MS + 1000,
    });
    expect(result.withinStartupGrace).toBe(false);
  });

  it('does not grant grace when uptime cannot be determined', async () => {
    // This is the honest default: an unknown uptime must not silently suppress
    // a real, sustained outage the way the 2026-08-20 incident did.
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: async () => null });
    expect(result.withinStartupGrace).toBe(false);
  });

  it('does not report withinStartupGrace on a successful probe', async () => {
    const fetchImpl = fakeFetch({ json: async () => ({ data: [{ id: 'Qwen3-VL' }] }) });
    const result = await probeVlmHealth({ fetchImpl, serviceUptimeMs: async () => 1000 });
    expect(result.withinStartupGrace).toBe(false);
  });

  it('never shells out to systemctl on a successful probe', async () => {
    // Regression: the uptime lookup used to run unconditionally on every
    // tick, including the common healthy case where its result is discarded.
    const uptimeLookup = vi.fn().mockResolvedValue(1000);
    const fetchImpl = fakeFetch({ json: async () => ({ data: [{ id: 'Qwen3-VL' }] }) });
    await probeVlmHealth({ fetchImpl, serviceUptimeMs: uptimeLookup });
    expect(uptimeLookup).not.toHaveBeenCalled();
  });

  it('does shell out to systemctl when the probe fails', async () => {
    const uptimeLookup = vi.fn().mockResolvedValue(1000);
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    await probeVlmHealth({ fetchImpl, serviceUptimeMs: uptimeLookup });
    expect(uptimeLookup).toHaveBeenCalledTimes(1);
  });
});

/**
 * `execFileSyncPoison` throws distinctively if anything still calls the sync
 * form. Combined with asserting it was NEVER called, this is what actually
 * proves the async path is used — a mutation test confirmed the previous
 * version of these tests (which only checked the parsed *result*) still
 * passed after reverting to `execFileSync`, because the sync throw landed in
 * the same try/catch and produced an identical null-uptime result. The
 * result alone cannot distinguish sync from async; only observing which
 * function was invoked can.
 */
function mockChildProcess(execFile: (...args: unknown[]) => void) {
  const execFileSyncPoison = vi.fn(() => {
    throw new Error('execFileSync must not be called — probe.ts must use the async execFile');
  });
  vi.doMock('child_process', () => ({
    execFile,
    execFileSync: execFileSyncPoison,
    default: { execFile, execFileSync: execFileSyncPoison },
  }));
  return { execFileSyncPoison };
}

describe('defaultServiceUptimeMs (real systemctl path)', () => {
  it('computes uptime from a valid ActiveEnterTimestamp via the async execFile, not execFileSync', async () => {
    const enteredAt = new Date(Date.now() - 60_000); // 1 minute ago
    const execFileSpy = vi.fn(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) =>
        cb(null, { stdout: `${enteredAt.toISOString()}\n`, stderr: '' }),
    );
    const { execFileSyncPoison } = mockChildProcess(execFileSpy);
    vi.resetModules();
    const { probeVlmHealth: probeWithRealUptime } = await import('./probe');
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeWithRealUptime({ fetchImpl });
    // 1 minute of uptime is well inside the 25-minute grace window — this
    // value could only come from the parsed timestamp, not a swallowed error.
    expect(result.withinStartupGrace).toBe(true);
    expect(execFileSpy).toHaveBeenCalledTimes(1);
    expect(execFileSyncPoison).not.toHaveBeenCalled();
  });

  it('treats "n/a" (service never started) as unknown uptime, not a crash', async () => {
    const execFileSpy = vi.fn(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) =>
        cb(null, { stdout: 'n/a\n', stderr: '' }),
    );
    const { execFileSyncPoison } = mockChildProcess(execFileSpy);
    vi.resetModules();
    const { probeVlmHealth: probeWithRealUptime } = await import('./probe');
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeWithRealUptime({ fetchImpl });
    expect(result.withinStartupGrace).toBe(false);
    expect(execFileSpy).toHaveBeenCalledTimes(1);
    expect(execFileSyncPoison).not.toHaveBeenCalled();
  });

  it('does not throw when systemctl itself fails (e.g. not installed, timeout)', async () => {
    const execFileSpy = vi.fn(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void) =>
        cb(new Error('command not found'), undefined),
    );
    const { execFileSyncPoison } = mockChildProcess(execFileSpy);
    vi.resetModules();
    const { probeVlmHealth: probeWithRealUptime } = await import('./probe');
    const fetchImpl = fakeFetch({ ok: false, status: 502 });
    const result = await probeWithRealUptime({ fetchImpl });
    expect(result.withinStartupGrace).toBe(false);
    expect(result.modelId).toBeNull();
    expect(execFileSpy).toHaveBeenCalledTimes(1);
    expect(execFileSyncPoison).not.toHaveBeenCalled();
  });
});
