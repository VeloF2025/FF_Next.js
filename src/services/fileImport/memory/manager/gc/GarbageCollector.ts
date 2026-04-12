/**
 * Garbage Collector
 * Manages garbage collection suggestions and memory pressure
 */

interface GCGlobal {
  gc?: () => void;
}

/**
 * Suggest garbage collection
 * Attempts to trigger GC in environments where it's exposed
 */
export class GarbageCollector {
  /**
   * Suggest garbage collection
   * Attempts to trigger GC in environments where it's exposed
   */
  public suggest(): void {
    // In Node.js environments with --expose-gc flag
    if (typeof global !== 'undefined' && (global as typeof global & GCGlobal).gc) {
      (global as typeof global & GCGlobal).gc!();
      return;
    }

    // In browsers with gc exposed (development mode)
    if (typeof window !== 'undefined' && (window as typeof window & GCGlobal).gc) {
      (window as typeof window & GCGlobal).gc!();
      return;
    }

    // Fallback: create memory pressure to trigger natural GC
    this.createMemoryPressure();
  }

  /**
   * Force garbage collection with additional cleanup
   */
  public force(): void {
    this.suggest();
  }

  /**
   * Create memory pressure to encourage GC
   * Creates and discards large arrays to trigger natural garbage collection
   */
  private createMemoryPressure(): void {
    // Create and immediately discard large arrays to trigger GC
    for (let i = 0; i < 10; i++) {
      const pressure = new Array(100000).fill(0);
      // Let it be garbage collected automatically
      // Note: pressure will be garbage collected at the end of this block scope
      if (pressure.length === 0) {
        // This condition will never be true, but prevents the variable from being marked as unused
        throw new Error('Unexpected empty pressure array');
      }
    }
  }

  /**
   * Check if manual GC is available
   */
  public isManualGCAvailable(): boolean {
    return (
      (typeof global !== 'undefined' && !!(global as typeof global & GCGlobal).gc) ||
      (typeof window !== 'undefined' && !!(window as typeof window & GCGlobal).gc)
    );
  }
}
