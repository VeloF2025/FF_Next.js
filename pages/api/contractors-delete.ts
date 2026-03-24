/**
 * Contractors Delete API - Flat Route (Vercel Workaround)
 * Permanently deletes a contractor from the database
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method!, ['DELETE']);
  }

  try {
    const { id } = req.body;

    if (!id || typeof id !== 'string') {
      return apiResponse.badRequest(res, 'Invalid or missing ID');
    }

    // Check if contractor exists
    const [existing] = await sql`SELECT id, company_name FROM contractors WHERE id = ${id}`;
    if (!existing) {
      return apiResponse.notFound(res, 'Contractor not found');
    }

    // Check for related records that would prevent deletion
    const [projectCount] = await sql`
      SELECT COUNT(*) as count FROM contractor_projects WHERE contractor_id = ${id}
    `;

    if (projectCount && parseInt(projectCount.count) > 0) {
      return res.status(409).json({
        error: `Cannot delete contractor "${existing.company_name}" - they have ${projectCount.count} linked project(s). Remove project assignments first or suspend the contractor instead.`
      });
    }

    // Delete related records first (cascade manually for safety)
    await sql`DELETE FROM contractor_onboarding_stages WHERE contractor_id = ${id}`;
    await sql`DELETE FROM contractor_documents WHERE contractor_id = ${id}`;

    // Delete the contractor
    await sql`DELETE FROM contractors WHERE id = ${id}`;

    log.info('Contractor permanently deleted', {
      contractorId: id,
      companyName: existing.company_name
    }, 'contractors-delete');

    return res.status(200).json({
      success: true,
      message: `Contractor "${existing.company_name}" permanently deleted`
    });
  } catch (error: any) {
    log.error('Error deleting contractor', { error }, 'contractors-delete');

    // Handle foreign key constraint violations
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'Cannot delete contractor - they have related records. Please suspend instead.'
      });
    }

    return apiResponse.internalError(res, new Error('Failed to delete contractor'));
  }
}

export default withAuth(handler);
