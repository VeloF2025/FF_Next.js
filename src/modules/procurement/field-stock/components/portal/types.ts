/**
 * Stock Portal Types
 * Shared type definitions for the storeman portal state machine
 */

export type PortalView = 'home' | 'checkout' | 'consume' | 'return' | 'receive';

export interface ScannedSerial {
  /** Raw scanned serial number */
  serial: string;
  /** Optional resolved item name from lookup */
  itemName?: string;
  /** Stock item ID from lookup */
  stockItemId?: string;
  /** Serial record ID from lookup */
  serialId?: string;
}

export interface ReturnItem extends ScannedSerial {
  /** Condition of the returned item */
  condition: 'good' | 'fair' | 'damaged';
}

export interface SerialLookupResult {
  found: boolean;
  serialId?: string;
  serialNumber?: string;
  stockItemId?: string;
  itemName?: string;
  itemCode?: string;
  status?: string;
  locationName?: string;
  error?: string;
}
