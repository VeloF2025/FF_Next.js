import { describe, it, expect, vi } from 'vitest';
import { handler } from '../metrics-match';

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

function payload(res: ReturnType<typeof mockRes>) {
  const body = res.json.mock.calls.at(-1)?.[0] as { data?: Record<string, unknown> } | undefined;
  return body?.data ?? {};
}

describe('GET /api/metrics-match', () => {
  it('rejects POST — MCP tokens are GET-only', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects a missing question with 400', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a blank question with 400 rather than matching nothing', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: { q: '   ' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a duplicated q parameter', async () => {
    const res = mockRes();
    await handler({ method: 'GET', query: { q: ['a', 'b'] } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('resolves a question to a metric key', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', query: { q: 'how many open pre-provisions' } } as never,
      res as never,
    );
    const data = payload(res) as { kind: string; metric?: { key: string } };
    expect(data.kind).toBe('exact');
    expect(data.metric?.key).toBe('pp_open_balance');
  });

  it('reports no match so the caller can fall back to RAG', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', query: { q: 'what did we discuss about splicing' } } as never,
      res as never,
    );
    expect((payload(res) as { kind: string }).kind).toBe('none');
  });

  it('never leaks the citation string, which names internal tables', async () => {
    // metrics-match is not permission-filtered — it returns only keys and labels.
    // `cite` documents internal tables and predicates and belongs to metrics-list,
    // which IS filtered.
    const res = mockRes();
    await handler(
      { method: 'GET', query: { q: 'how many open pre-provisions' } } as never,
      res as never,
    );
    expect(JSON.stringify(payload(res))).not.toContain('metric_snapshots');
  });
});
