import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Guards the 2026-07-10 production outage fix: during `next build` the pool must
 * hold NO connection floor and skip warm-up, so the ~30 jest-worker children
 * spawned for static generation don't each pin a permanent `fibreflow_user`
 * connection and leak it when the build orphans them (which exhausted
 * max_connections and locked the live app out).
 */

type ResolvePoolConfig = typeof import('@/lib/db')['resolvePoolConfig'];
let resolvePoolConfig: ResolvePoolConfig;

beforeAll(async () => {
  // Set build phase BEFORE loading the module so its load-time warm-up
  // (pool.connect) is skipped and the test never opens a real DB connection.
  // vi.importActual bypasses the global @/lib/db mock in vitest.setup.ts so we
  // exercise the real resolvePoolConfig.
  process.env.NEXT_PHASE = 'phase-production-build';
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  resolvePoolConfig = actual.resolvePoolConfig;
});

describe('resolvePoolConfig — build-phase connection-leak guard', () => {
  it('runtime (no NEXT_PHASE) keeps a warm connection floor of 1', () => {
    const cfg = resolvePoolConfig({});
    expect(cfg.isBuildPhase).toBe(false);
    expect(cfg.min).toBe(1);
    expect(cfg.applicationName).toBe('ff-pg-app');
  });

  it('runtime app_name identifies the env by PORT', () => {
    expect(resolvePoolConfig({ PORT: '3000' }).applicationName).toBe('ff-pg-3000');
    expect(resolvePoolConfig({ PORT: '3005' }).applicationName).toBe('ff-pg-3005');
  });

  it('build phase uses min:0 (no per-worker floor) and a distinct app_name', () => {
    const cfg = resolvePoolConfig({ NEXT_PHASE: 'phase-production-build' });
    expect(cfg.isBuildPhase).toBe(true);
    expect(cfg.min).toBe(0);
    expect(cfg.applicationName).toBe('ff-pg-build');
  });

  it('build phase forces min:0 even if PORT is present', () => {
    const cfg = resolvePoolConfig({ NEXT_PHASE: 'phase-production-build', PORT: '3000' });
    expect(cfg.isBuildPhase).toBe(true);
    expect(cfg.min).toBe(0);
    expect(cfg.applicationName).toBe('ff-pg-3000');
  });
});
