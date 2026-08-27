/**
 * Stale-chunk auto-recovery tests.
 * jsdom's location.reload throws "Not implemented", so window.location is
 * replaced with a stub carrying a vi.fn() reload per test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isChunkLoadError,
  reloadOnceForChunkError,
  installChunkErrorReload,
} from '../chunkReload';

const reload = vi.fn();

function chunkError(): Error {
  const err = new Error('Loading chunk 4523 failed.');
  err.name = 'ChunkLoadError';
  return err;
}

// jsdom re-raises an unhandled ErrorEvent as an uncaught exception; swallow
// dispatches the module under test deliberately leaves unhandled.
function dispatchSwallowed(event: Event) {
  const swallow = (e: Event) => e.preventDefault();
  window.addEventListener('error', swallow);
  window.dispatchEvent(event);
  window.removeEventListener('error', swallow);
}

beforeEach(() => {
  reload.mockClear();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    writable: true,
    configurable: true,
  });
});

describe('isChunkLoadError (matcher)', () => {
  it('matches the ChunkLoadError name regardless of message', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
  });

  it('matches "Loading chunk N failed" by message alone', () => {
    expect(isChunkLoadError(new Error('Loading chunk 88 failed. (missing: /_next/static/chunks/88.js)'))).toBe(true);
  });

  it('matches CSS chunk failures', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed'))).toBe(true);
  });

  it('matches failed dynamic imports (Error and bare string reason)', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://app.fibreflow.app/_next/x.js'))).toBe(true);
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true);
  });

  it('does NOT match ordinary errors (kills matcher-widening mutants)', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({})).toBe(false);
  });
});

describe('reloadOnceForChunkError (once-only guard)', () => {
  it('reloads on the first chunk failure', () => {
    expect(reloadOnceForChunkError(chunkError())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload a second time for the same key (kills guard-drop mutants)', () => {
    expect(reloadOnceForChunkError(chunkError())).toBe(true);
    expect(reloadOnceForChunkError(chunkError())).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again for a DIFFERENT failing chunk', () => {
    const other = new Error('Loading chunk 999 failed.');
    other.name = 'ChunkLoadError';
    expect(reloadOnceForChunkError(chunkError())).toBe(true);
    expect(reloadOnceForChunkError(other)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads for a non-chunk error', () => {
    expect(reloadOnceForChunkError(new Error('boom'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when sessionStorage is unavailable (loop cannot be guarded)', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage disabled');
      });
    expect(reloadOnceForChunkError(chunkError())).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('installChunkErrorReload (window listeners)', () => {
  it('reloads on a window error event carrying a chunk error', () => {
    const cleanup = installChunkErrorReload();
    window.dispatchEvent(new ErrorEvent('error', { error: chunkError() }));
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('reloads on an unhandled rejection with a chunk-error reason', () => {
    const cleanup = installChunkErrorReload();
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', {
      value: new TypeError('Failed to fetch dynamically imported module: /x.js'),
    });
    window.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('ignores non-chunk errors and stops listening after cleanup', () => {
    const cleanup = installChunkErrorReload();
    dispatchSwallowed(new ErrorEvent('error', { error: new Error('boom') }));
    expect(reload).not.toHaveBeenCalled();
    cleanup();
    dispatchSwallowed(new ErrorEvent('error', { error: chunkError() }));
    expect(reload).not.toHaveBeenCalled();
  });
});
