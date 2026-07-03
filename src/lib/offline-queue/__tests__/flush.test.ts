import { describe, expect, it, vi } from 'vitest';
import { defaultClassify, flushQueue, MAX_ATTEMPTS_BEFORE_DRAIN } from '../flush';
import type { QueuedItem, FlushHooks } from '../types';

function item(id: string, attempts = 0): QueuedItem<{ n: string }> {
  return { id, payload: { n: id }, queuedAt: id, attempts };
}
function hooks(): FlushHooks & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onSuccess: async (id) => { calls.push(`success:${id}`); },
    onDrain: async (id) => { calls.push(`drain:${id}`); },
    onTransient: async (id) => { calls.push(`transient:${id}`); },
    onAbandon: async (id) => { calls.push(`abandon:${id}`); },
  };
}

describe('flushQueue', () => {
  it('deletes (succeeds) a successful item', async () => {
    const h = hooks();
    const report = await flushQueue([item('1')], async () => ({ drain: true }), h);
    expect(report.succeeded).toBe(1);
    expect(report.drained).toBe(0);
    expect(h.calls).toEqual(['success:1']);
  });

  it('drains a permanently-failed item into the dropped store', async () => {
    const h = hooks();
    const report = await flushQueue(
      [item('1')],
      async () => ({ drain: true, errorMessage: 'perm' }),
      h
    );
    expect(report.drained).toBe(1);
    expect(h.calls).toEqual(['drain:1']);
  });

  it('keeps a transient failure and early-exits the rest', async () => {
    const h = hooks();
    const submit = vi.fn(async () => ({ drain: false, errorMessage: '5xx' }));
    const report = await flushQueue([item('1'), item('2')], submit, h);
    expect(report.kept).toBe(1);
    expect(submit).toHaveBeenCalledTimes(1); // early exit — item 2 not attempted
    expect(h.calls).toEqual(['transient:1']);
  });

  it('abandons an item past the attempts cap without calling submit', async () => {
    const h = hooks();
    const submit = vi.fn(async () => ({ drain: true }));
    const report = await flushQueue([item('1', MAX_ATTEMPTS_BEFORE_DRAIN)], submit, h);
    expect(submit).not.toHaveBeenCalled();
    expect(h.calls).toEqual(['abandon:1']);
    expect(report.drained).toBe(1);
  });

  it('treats a thrown error as transient (keep)', async () => {
    const h = hooks();
    const report = await flushQueue([item('1')], async () => { throw new Error('net'); }, h);
    expect(report.kept).toBe(1);
    expect(h.calls).toEqual(['transient:1']);
  });
});

describe('defaultClassify', () => {
  it('drains a 409 status', () => {
    expect(defaultClassify({ status: 409 }).drain).toBe(true);
  });

  it('drains a 400 status', () => {
    expect(defaultClassify({ status: 400 }).drain).toBe(true);
  });

  it('keeps a 500 status', () => {
    expect(defaultClassify({ status: 500 }).drain).toBe(false);
  });

  it('keeps a plain Error', () => {
    expect(defaultClassify(new Error('x')).drain).toBe(false);
  });
});
