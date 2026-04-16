// Vitest-only no-op stub for @sentry/nextjs
// Production builds use the real package; this shim prevents transform errors in tests.
export const setTag = (_key: string, _value: string): void => undefined;
export const captureException = (_err: unknown): void => undefined;
export const captureMessage = (_msg: string): void => undefined;
export const withScope = (fn: (scope: unknown) => void): void => fn({});
export const withIsolationScope = (fn: (scope: unknown) => unknown): unknown => fn({});
export const getCurrentHub = (): unknown => ({ getScope: () => ({}) });
export const init = (_options?: unknown): void => undefined;
