import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * Guards the 2026-07-10 production outage fix: during `next build` the pool must
 * hold NO connection floor and skip warm-up, so the ~30 jest-worker children
 * spawned for static generation don't each pin a permanent `fibreflow_user`
 * connection and leak it when the build orphans them (which exhausted
 * max_connections and locked the live app out).
 */

type DbModule = typeof import('@/lib/db');
let dbModule: DbModule;
let resolvePoolConfig: DbModule['resolvePoolConfig'];

beforeAll(async () => {
  // Stub build phase BEFORE loading the module so its load-time warm-up
  // (pool.connect) is skipped and the test never opens a real DB connection.
  // vi.stubEnv is auto-reverted by unstubAllEnvs() below, so NEXT_PHASE can't
  // leak into other test files. vi.importActual bypasses the global @/lib/db
  // mock in vitest.setup.ts so we exercise the real module.
  vi.stubEnv('NEXT_PHASE', 'phase-production-build');
  dbModule = await vi.importActual<DbModule>('@/lib/db');
  resolvePoolConfig = dbModule.resolvePoolConfig;
});

afterAll(() => {
  vi.unstubAllEnvs();
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

describe('exported Pool wiring (regression guard for the outage fix)', () => {
  // The module was imported under NEXT_PHASE=phase-production-build in beforeAll,
  // so the real Pool must have been constructed FROM resolvePoolConfig — i.e. with
  // min:0 and the build app_name. This fails if a future edit re-hardcodes min:1
  // or unwires resolvePoolConfig from `new Pool(...)`: the exact regressions that
  // would reintroduce the leak while leaving the pure-function tests green.
  it('constructs the Pool with the resolved build-phase config', () => {
    const options = (dbModule.pool as unknown as {
      options: { min?: number; application_name?: string };
    }).options;
    expect(options.min).toBe(0);
    expect(options.application_name).toBe('ff-pg-build');
  });
});
