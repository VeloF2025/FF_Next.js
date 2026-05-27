/**
 * Receipt category taxonomy.
 *
 * Closed list — adding a new category is a code change here, not a SQL
 * migration. The VLM is prompted with this exact list so its
 * categoryGuess always falls inside the set; no normalisation needed
 * downstream.
 *
 * Order matters: it's the order shown to staff in the dropdown. Most
 * common categories first.
 */

export const RECEIPT_CATEGORIES = [
  'fuel',
  'tools',
  'equipment',
  'materials',
  'food',
  'accommodation',
  'parking',
  'tolls',
  'office_supplies',
  'courier',
  'other',
] as const;

export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

export const RECEIPT_CATEGORY_LABELS: Record<ReceiptCategory, string> = {
  fuel: 'Fuel',
  tools: 'Tools',
  equipment: 'Equipment',
  materials: 'Materials',
  food: 'Food',
  accommodation: 'Accommodation',
  parking: 'Parking',
  tolls: 'Tolls',
  office_supplies: 'Office supplies',
  courier: 'Courier',
  other: 'Other',
};

export function isValidReceiptCategory(value: unknown): value is ReceiptCategory {
  return typeof value === 'string' && (RECEIPT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Normalise a candidate category string from the VLM (or any external
 * source) into the closed taxonomy. Returns 'other' when the input
 * doesn't match — never throws, so the import path can be lenient.
 */
export function coerceReceiptCategory(value: unknown): ReceiptCategory {
  if (typeof value !== 'string') return 'other';
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, '_');
  return isValidReceiptCategory(trimmed) ? trimmed : 'other';
}
