/**
 * Phase 4: Cross-Module GL Integration Hooks
 * - PO approved → DR Materials + VAT Input, CR AP (commitment accounting)
 * - Asset depreciation → DR Depreciation Expense, CR Accumulated Depreciation
 */

import { sql } from '@/lib/neon';
import { log } from '@/lib/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const ACCOUNTS = {
  VAT_INPUT: '1140',
  ACCUM_DEPRECIATION: '1230',
  AP: '2110',
  MATERIALS: '5100',
  DEPRECIATION_EXPENSE: '5800',
} as const;

async function getAccountId(code: string): Promise<string> {
  const rows = (await sql`SELECT id FROM gl_accounts WHERE account_code = ${code} LIMIT 1`) as Row[];
  if (!rows[0]) throw new Error(`GL account ${code} not found`);
  return String(rows[0].id);
}

// ── Purchase Order Approved → GL (Commitment Accounting) ────────────────────

export async function postPurchaseOrderToGL(
  poId: string,
  userId: string
): Promise<string | null> {
  try {
    const po = (await sql`
      SELECT id, po_number, total_amount, tax_amount, project_id, gl_journal_entry_id
      FROM purchase_orders WHERE id = ${poId}
    `) as Row[];

    if (!po[0]) { log.warn('PO not found for GL posting', { poId }, 'accounting'); return null; }
    if (po[0].gl_journal_entry_id) return String(po[0].gl_journal_entry_id);

    const totalAmount = Number(po[0].total_amount || 0);
    const taxAmount = Number(po[0].tax_amount || 0);
    const netAmount = totalAmount - taxAmount;
    if (totalAmount === 0) return null;

    const materialsId = await getAccountId(ACCOUNTS.MATERIALS);
    const apId = await getAccountId(ACCOUNTS.AP);
    const vatInputId = await getAccountId(ACCOUNTS.VAT_INPUT);
    const projectId = po[0].project_id ? String(po[0].project_id) : null;

    const entry = (await sql`
      INSERT INTO gl_journal_entries (
        entry_number, entry_date, description, source, status,
        total_debit, total_credit, created_by
      ) VALUES (
        ${`PO-${po[0].po_number}`}, CURRENT_DATE,
        ${`Purchase order ${po[0].po_number} approved — commitment`},
        'auto_purchase_order', 'posted', ${totalAmount}, ${totalAmount}, ${userId}
      ) RETURNING id
    `) as Row[];

    const entryId = String(entry[0].id);

    if (projectId) {
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
        VALUES (${entryId}::UUID, ${materialsId}::UUID, ${netAmount}, 0,
          ${`PO ${po[0].po_number} materials`}, ${projectId}::UUID)
      `;
      if (taxAmount > 0.01) {
        await sql`
          INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
          VALUES (${entryId}::UUID, ${vatInputId}::UUID, ${taxAmount}, 0,
            ${`PO ${po[0].po_number} VAT`}, ${projectId}::UUID)
        `;
      }
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
        VALUES (${entryId}::UUID, ${apId}::UUID, 0, ${totalAmount},
          ${`PO ${po[0].po_number}`}, ${projectId}::UUID)
      `;
    } else {
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description)
        VALUES (${entryId}::UUID, ${materialsId}::UUID, ${netAmount}, 0, ${`PO ${po[0].po_number} materials`})
      `;
      if (taxAmount > 0.01) {
        await sql`
          INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description)
          VALUES (${entryId}::UUID, ${vatInputId}::UUID, ${taxAmount}, 0, ${`PO ${po[0].po_number} VAT`})
        `;
      }
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description)
        VALUES (${entryId}::UUID, ${apId}::UUID, 0, ${totalAmount}, ${`PO ${po[0].po_number}`})
      `;
    }

    await sql`UPDATE purchase_orders SET gl_journal_entry_id = ${entryId}::UUID WHERE id = ${poId}`;

    log.info('PO GL posted', { poId, entryId, totalAmount }, 'accounting');
    return entryId;
  } catch (err) {
    log.error('Failed to post PO to GL', { poId, error: err }, 'accounting');
    return null;
  }
}

// ── Asset Depreciation → GL ────────────────────────────────────────────────

export async function postAssetDepreciationToGL(
  assetId: string,
  depreciationAmount: number,
  userId: string
): Promise<string | null> {
  try {
    if (depreciationAmount <= 0) return null;

    const asset = (await sql`
      SELECT id, asset_number, name FROM assets WHERE id = ${assetId}
    `) as Row[];

    if (!asset[0]) { log.warn('Asset not found for depreciation GL', { assetId }, 'accounting'); return null; }

    const depExpenseId = await getAccountId(ACCOUNTS.DEPRECIATION_EXPENSE);
    const accumDepId = await getAccountId(ACCOUNTS.ACCUM_DEPRECIATION);

    const entry = (await sql`
      INSERT INTO gl_journal_entries (
        entry_number, entry_date, description, source, status,
        total_debit, total_credit, created_by
      ) VALUES (
        ${`DEP-${asset[0].asset_number}-${new Date().toISOString().slice(0, 7)}`}, CURRENT_DATE,
        ${`Depreciation: ${asset[0].name} (${asset[0].asset_number})`},
        'auto_depreciation', 'posted', ${depreciationAmount}, ${depreciationAmount}, ${userId}
      ) RETURNING id
    `) as Row[];

    const entryId = String(entry[0].id);

    await sql`
      INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description)
      VALUES (${entryId}::UUID, ${depExpenseId}::UUID, ${depreciationAmount}, 0,
        ${`Depreciation: ${asset[0].asset_number}`})
    `;
    await sql`
      INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description)
      VALUES (${entryId}::UUID, ${accumDepId}::UUID, 0, ${depreciationAmount},
        ${`Depreciation: ${asset[0].asset_number}`})
    `;

    await sql`
      UPDATE assets SET
        accumulated_depreciation = COALESCE(accumulated_depreciation, 0) + ${depreciationAmount},
        current_book_value = COALESCE(purchase_price, 0) - (COALESCE(accumulated_depreciation, 0) + ${depreciationAmount}),
        updated_at = NOW()
      WHERE id = ${assetId}
    `;

    log.info('Asset depreciation GL posted', { assetId, entryId, depreciationAmount }, 'accounting');
    return entryId;
  } catch (err) {
    log.error('Failed to post asset depreciation to GL', { assetId, error: err }, 'accounting');
    return null;
  }
}
