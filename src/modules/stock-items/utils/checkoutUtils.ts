/**
 * Shared utility for mapping tool_checkouts DB rows to API response format.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapCheckoutRow(row: Record<string, any>) {
  return {
    id: row.id,
    stockItemId: row.stock_item_id,
    serialNumber: row.serial_number,
    checkedOutBy: row.checked_out_by,
    checkedOutByName: row.checked_out_by_name ?? undefined,
    checkedOutByEmail: row.checked_out_by_email ?? undefined,
    jobSiteId: row.job_site_id,
    jobSiteName: row.job_site_name,
    expectedReturnDate: row.expected_return_date,
    checkedOutAt: row.checked_out_at,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checked_in_by,
    checkedInByName: row.checked_in_by_name ?? undefined,
    conditionNotes: row.condition_notes,
    status: row.status,
    itemCode: row.item_code ?? undefined,
    itemName: row.item_name ?? undefined,
    category: row.category ?? undefined,
  };
}
