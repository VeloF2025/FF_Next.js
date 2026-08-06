/**
 * Guards the sidebar-collapse fix: Leaflet only re-measures on a window
 * `resize` event, but inside AppLayout the map's container changes width
 * without one (sidebar toggle, and the persisted-collapse restore on
 * hydration). FleetMap must observe its own container and invalidateSize.
 *
 * Removing <InvalidateSizeOnContainerResize /> from FleetMap fails these.
 */
import { render, cleanup } from '@testing-library/react';
import { Map as LeafletMap } from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FleetMap from '../FleetMap';

/** ResizeObserver stub whose callbacks we fire by hand. */
class ControllableResizeObserver {
  static instances: ControllableResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    ControllableResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  /** Simulate the browser reporting a container size change. */
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** Captures rAF callbacks so we can assert on coalescing explicitly. */
function stubAnimationFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id);
  });
  return {
    pendingCount: () => pending.size,
    flush: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((cb) => cb(0));
    },
  };
}

function setup() {
  ControllableResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', ControllableResizeObserver);
  const frames = stubAnimationFrames();
  const invalidateSize = vi.spyOn(LeafletMap.prototype, 'invalidateSize');
  invalidateSize.mockClear();
  const view = render(<FleetMap vehicles={[]} />);
  const observer = ControllableResizeObserver.instances[0];
  return { view, observer, frames, invalidateSize };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FleetMap container resize handling', () => {
  it('observes the map container', () => {
    const { observer, view } = setup();

    expect(observer).toBeDefined();
    expect(observer.observed).toHaveLength(1);
    // Leaflet's own container element, not some ancestor.
    expect(observer.observed[0]).toBe(
      view.container.querySelector('.leaflet-container'),
    );
  });

  it('calls invalidateSize when the container resizes', () => {
    const { observer, frames, invalidateSize } = setup();
    const before = invalidateSize.mock.calls.length;

    observer.fire();
    frames.flush();

    expect(invalidateSize.mock.calls.length).toBeGreaterThan(before);
  });

  it('coalesces a burst of resizes into a single invalidateSize', () => {
    const { observer, frames, invalidateSize } = setup();
    const before = invalidateSize.mock.calls.length;

    // The sidebar transition runs 300ms and fires continuously.
    observer.fire();
    observer.fire();
    observer.fire();
    expect(frames.pendingCount()).toBe(1);

    frames.flush();

    expect(invalidateSize.mock.calls.length - before).toBe(1);
  });

  it('disconnects the observer on unmount', () => {
    const { observer, view } = setup();

    view.unmount();

    expect(observer.disconnected).toBe(true);
  });
});
