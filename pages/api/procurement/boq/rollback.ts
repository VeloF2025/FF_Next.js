import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, getUser } from '@/lib/auth';
import { generateBOQVersion } from '@/lib/utils/boq/versioning';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Rollback / restore a previous BOQ version.
 * Creates a NEW version with items copied from the source version.
 * Marks the current active version as 'superseded'.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { sourceBoqId } = req.body;

  if (!sourceBoqId || typeof sourceBoqId !== 'string') {
    return apiResponse.badRequest(res, 'sourceBoqId is required');
  }

  const user = getUser(req);
  if (!user) {
    return apiResponse.unauthorized(res, 'Authentication required');
  }

  try {
    // Get the source BOQ
    const sourceRows = await sql`
      SELECT id, project_id, title, description, version, status, file_name, currency
      FROM boqs WHERE id = ${sourceBoqId}
    `;

    if (!sourceRows[0]) {
      return apiResponse.notFound(res, 'Source BOQ', sourceBoqId);
    }

    const source = sourceRows[0];

    // Get all existing versions for this project to generate next version number
    const existingVersions = await sql`
      SELECT version FROM boqs WHERE project_id = ${source.project_id}
    `;
    const versionStrings = existingVersions.map((v: { version: string }) => v.version);
    const newVersion = generateBOQVersion(versionStrings);

    // Get source items
    const sourceItems = await sql`
      SELECT item_number, description, unit, quantity, rate, amount, category,
             material_code, mapped_material_id, mapping_confidence, is_mapped,
             mapping_notes, item_code, sequence_number, stock_item_id,
             stock_match_confidence, stock_match_method, custom_fields
      FROM boq_items
      WHERE boq_id = ${sourceBoqId}
      ORDER BY sequence_number, item_number
    `;

    if (sourceItems.length === 0) {
      return apiResponse.badRequest(res, 'Source BOQ has no items to restore');
    }

    // Calculate totals from source items
    const totalValue = sourceItems.reduce(
      (sum: number, item: { amount: string | null; quantity: string; rate: string }) =>
        sum + (Number(item.amount) || Number(item.quantity) * Number(item.rate) || 0),
      0
    );
    const mappedCount = sourceItems.filter((i: { is_mapped: boolean }) => i.is_mapped).length;

    // Mark current active/draft versions as superseded
    await sql`
      UPDATE boqs
      SET status = 'superseded', updated_at = NOW()
      WHERE project_id = ${source.project_id}
        AND status IN ('draft', 'active', 'approved', 'uploaded', 'mapped')
        AND id != ${sourceBoqId}
    `;

    // Create the new BOQ version
    const newBoqRows = await sql`
      INSERT INTO boqs (
        project_id, version, title, description, status,
        uploaded_by, file_name, currency,
        item_count, mapped_items, unmapped_items,
        total_estimated_value, mapping_status
      ) VALUES (
        ${source.project_id},
        ${newVersion},
        ${source.title || 'Restored BOQ'},
        ${'Restored from ' + source.version + ' (rollback)'},
        'draft',
        ${user.name || user.email || 'System'},
        ${source.file_name},
        ${source.currency || 'ZAR'},
        ${sourceItems.length},
        ${mappedCount},
        ${sourceItems.length - mappedCount},
        ${totalValue},
        ${mappedCount > 0 ? 'completed' : 'pending'}
      )
      RETURNING id, version
    `;

    const newBoq = newBoqRows[0]!; // Guaranteed by INSERT RETURNING

    // Copy items — insert in batches for large BOQs
    for (const item of sourceItems) {
      await sql`
        INSERT INTO boq_items (
          boq_id, project_id, item_number, description, unit, quantity, rate, amount,
          category, material_code, mapped_material_id, mapping_confidence,
          is_mapped, mapping_notes, item_code, sequence_number,
          stock_item_id, stock_match_confidence, stock_match_method, custom_fields
        ) VALUES (
          ${newBoq.id}, ${source.project_id},
          ${item.item_number}, ${item.description}, ${item.unit},
          ${item.quantity}, ${item.rate}, ${item.amount},
          ${item.category}, ${item.material_code}, ${item.mapped_material_id},
          ${item.mapping_confidence}, ${item.is_mapped}, ${item.mapping_notes},
          ${item.item_code}, ${item.sequence_number},
          ${item.stock_item_id}, ${item.stock_match_confidence},
          ${item.stock_match_method}, ${item.custom_fields}
        )
      `;
    }

    // Log the rollback in change log
    await sql`
      INSERT INTO boq_change_log (boq_id, action, field_changed, old_value, new_value, changed_by, changed_by_name, change_summary)
      VALUES (
        ${newBoq.id}, 'rollback', 'version',
        ${source.version}, ${newVersion},
        ${user.email || 'system'},
        ${user.name || user.email || 'System'},
        ${'Rolled back to version ' + source.version + ' (' + sourceItems.length + ' items restored)'}
      )
    `;

    log.info('BOQ rollback completed', {
      sourceId: sourceBoqId,
      sourceVersion: source.version,
      newId: newBoq.id,
      newVersion: newBoq.version,
      itemCount: sourceItems.length,
    });

    return apiResponse.success(res, {
      id: newBoq.id,
      version: newBoq.version,
      itemCount: sourceItems.length,
      message: `Restored version ${source.version} as new version ${newBoq.version}`,
    });
  } catch (error) {
    log.error('Failed to rollback BOQ version', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
