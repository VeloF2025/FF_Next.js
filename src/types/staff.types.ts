/**
 * Staff Types - Re-export all staff type definitions
 * This file maintains backward compatibility while organizing types into smaller modules
 *
 * NOTE: Firebase has been removed. Using local TimestampLike type instead.
 */

export * from './staff/index';

// Re-export Timestamp-like type for backward compatibility
// Firebase has been removed, using a compatible interface instead
export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
}

/**
 * Create a Timestamp-like object from a Date
 */
export function createTimestamp(date: Date = new Date()): TimestampLike {
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: (date.getTime() % 1000) * 1000000,
    toDate() {
      return new Date(this.seconds * 1000 + this.nanoseconds / 1000000);
    }
  };
}

// Export createTimestamp as Timestamp for backward compatibility
export const Timestamp = {
  now: () => createTimestamp(new Date()),
  fromDate: (date: Date) => createTimestamp(date)
};
