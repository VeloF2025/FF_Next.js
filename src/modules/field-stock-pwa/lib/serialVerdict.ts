/**
 * verdictForSerial — decides whether one scanned serial may be issued.
 *
 * Extracted from useScanSerial so the single-serial scan path and the batch
 * validation endpoint apply byte-identical rules. Pure: no imports, no I/O,
 * safe on both client and server.
 *
 * Rule order is deliberate and tested: missing → status → wrong item → wrong
 * location. Wrong item outranks wrong location because it is the more
 * fundamental mistake and the more useful message.
 *
 * A serial with no recorded location passes: missing data is not a
 * contradiction, and the process-step stock check still guards quantities.
 */

export const ISSUABLE_STATUSES: readonly string[] = ['available', 'in_stock'];

export interface SerialRecord {
  serialNumber: string;
  stockItemId: string;
  stockItemName: string | null;
  status: string;
  currentLocationId: string | null;
  currentLocationName: string | null;
}

export interface VerdictContext {
  expectedItemId: string;
  expectedItemName: string;
  sourceLocation: { id: string; name: string } | null;
}

export type SerialVerdict =
  | { valid: true; stockItemId: string; stockItemName: string }
  | { valid: false; errorMessage: string; stockItemId?: string; stockItemName?: string };

export function verdictForSerial(record: SerialRecord | null, ctx: VerdictContext): SerialVerdict {
  if (!record) return { valid: false, errorMessage: 'Serial number not found' };

  const stockItemName = record.stockItemName ?? '';

  if (!ISSUABLE_STATUSES.includes(record.status)) {
    return {
      valid: false,
      errorMessage: `Serial is not available (status: ${record.status})`,
      stockItemId: record.stockItemId,
      stockItemName,
    };
  }

  if (record.stockItemId && record.stockItemId !== ctx.expectedItemId) {
    return {
      valid: false,
      errorMessage: `Wrong stock item — scanned ${stockItemName || record.stockItemId}, expected ${ctx.expectedItemName}`,
      stockItemId: record.stockItemId,
      stockItemName,
    };
  }

  if (
    ctx.sourceLocation &&
    record.currentLocationId &&
    record.currentLocationId !== ctx.sourceLocation.id
  ) {
    return {
      valid: false,
      errorMessage: `Serial is at ${record.currentLocationName ?? 'another warehouse'}, not ${ctx.sourceLocation.name}`,
      stockItemId: record.stockItemId,
      stockItemName,
    };
  }

  return {
    valid: true,
    stockItemId: record.stockItemId || ctx.expectedItemId,
    stockItemName: stockItemName || ctx.expectedItemName,
  };
}
