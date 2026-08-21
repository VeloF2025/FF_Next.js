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
 *
 * A serial recorded at a DIFFERENT warehouse also passes — with a warning.
 * That location is an assumption: it comes from a SharePoint workbook tab that
 * denotes allocation, not presence, and was measured on 2026-08-21 to predict
 * the actual install project only 27.5% of the time. Refusing a handout on it
 * blocks real work over a guess — which is exactly what happened in 2026-07
 * (PCK-000009/10: serial recorded at Lawley, technician standing at
 * Garstfontein, 422 after he had already signed). Stock genuinely moves between
 * sites; the system's job is to record that it happened, not to forbid it.
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
  | {
      valid: true;
      stockItemId: string;
      stockItemName: string;
      /** Set when the serial is usable but something is worth recording. */
      warning?: string;
      /** The warehouse the serial was expected at, when it differs from source. */
      expectedLocationName?: string;
    }
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

  // Different warehouse: ALLOWED, and flagged. See the note at the top — this
  // location is an assumption, and stock legitimately moves between sites.
  if (
    ctx.sourceLocation &&
    record.currentLocationId &&
    record.currentLocationId !== ctx.sourceLocation.id
  ) {
    const expected = record.currentLocationName ?? 'another warehouse';
    return {
      valid: true,
      stockItemId: record.stockItemId || ctx.expectedItemId,
      stockItemName: stockItemName || ctx.expectedItemName,
      warning: `Expected at ${expected} — issuing from ${ctx.sourceLocation.name}`,
      expectedLocationName: expected,
    };
  }

  return {
    valid: true,
    stockItemId: record.stockItemId || ctx.expectedItemId,
    stockItemName: stockItemName || ctx.expectedItemName,
  };
}
