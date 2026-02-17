/**
 * Unified Expiring Documents API (PRD-058)
 * GET /api/projects/expiring-documents
 * Returns all documents expiring within X days across all sources:
 * - Pipeline approvals
 * - Contractor documents
 * - Contractor agreements (SOW/MBA)
 * - Project requirements
 * - Staff documents
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

export type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'upcoming' | 'ok';

export interface ExpiringDocument {
  id: string;
  source: 'pipeline_approval' | 'contractor_document' | 'agreement' | 'project_requirement' | 'staff_document';
  document_type: string;
  document_name: string;
  expiry_date: string;
  days_until_expiry: number;
  urgency: ExpiryUrgency;
  // Context
  project_id?: string;
  project_name?: string;
  contractor_id?: string;
  contractor_name?: string;
  staff_id?: string;
  staff_name?: string;
  // Details
  document_url?: string;
  status?: string;
}

interface ExpiryStats {
  total: number;
  expired: number;
  critical: number;
  warning: number;
  upcoming: number;
}

function calculateUrgency(daysUntilExpiry: number): ExpiryUrgency {
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 7) return 'critical';
  if (daysUntilExpiry <= 30) return 'warning';
  if (daysUntilExpiry <= 90) return 'upcoming';
  return 'ok';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  // Query params
  const { days = '90', project_id, source, max_expired } = req.query;
  const daysAhead = Math.min(365, Math.max(1, parseInt(String(days), 10) || 90));
  const projectIdStr = project_id ? String(project_id) : null;
  // max_expired: only show docs expired within this many days (default 90, 0 = no limit)
  // Uses 36500 (100 years) as effective "no limit" to avoid branching queries
  const maxExpiredDays = max_expired === '0'
    ? 36500
    : Math.max(1, parseInt(String(max_expired || '90'), 10));

  const client = await pool.connect();
  try {
    const documents: ExpiringDocument[] = [];

    // 1. Pipeline Approvals (via project_pipeline_links for project filtering)
    if (!source || source === 'pipeline_approval') {
      try {
        const result = projectIdStr
          ? await client.query(
              `SELECT
                pa.id::text,
                'pipeline_approval' as source,
                at.name as document_type,
                CONCAT(at.name, ' - ', pp.project_name) as document_name,
                pa.expiry_date,
                (pa.expiry_date - CURRENT_DATE)::int as days_until_expiry,
                ppl.project_id::text as project_id,
                pp.project_name,
                NULL as contractor_id,
                NULL as contractor_name,
                NULL as staff_id,
                NULL as staff_name,
                COALESCE(pa.approval_document_url, pa.application_document_url) as document_url,
                pa.status
              FROM pipeline_project_approvals pa
              JOIN pipeline_projects pp ON pa.pipeline_project_id = pp.id
              JOIN pipeline_approval_types at ON pa.approval_type_id = at.id
              JOIN project_pipeline_links ppl ON ppl.pipeline_project_id = pp.id
              WHERE pa.expiry_date IS NOT NULL
                AND pa.expiry_date >= CURRENT_DATE - $3::int
                AND pa.expiry_date <= CURRENT_DATE + $1::int
                AND ppl.project_id = $2::uuid
              ORDER BY pa.expiry_date ASC`,
              [daysAhead, projectIdStr, maxExpiredDays]
            )
          : await client.query(
              `SELECT
                pa.id::text,
                'pipeline_approval' as source,
                at.name as document_type,
                CONCAT(at.name, ' - ', pp.project_name) as document_name,
                pa.expiry_date,
                (pa.expiry_date - CURRENT_DATE)::int as days_until_expiry,
                COALESCE(ppl.project_id::text, pp.id::text) as project_id,
                pp.project_name,
                NULL as contractor_id,
                NULL as contractor_name,
                NULL as staff_id,
                NULL as staff_name,
                COALESCE(pa.approval_document_url, pa.application_document_url) as document_url,
                pa.status
              FROM pipeline_project_approvals pa
              JOIN pipeline_projects pp ON pa.pipeline_project_id = pp.id
              JOIN pipeline_approval_types at ON pa.approval_type_id = at.id
              LEFT JOIN project_pipeline_links ppl ON ppl.pipeline_project_id = pp.id
              WHERE pa.expiry_date IS NOT NULL
                AND pa.expiry_date >= CURRENT_DATE - $2::int
                AND pa.expiry_date <= CURRENT_DATE + $1::int
              ORDER BY pa.expiry_date ASC`,
              [daysAhead, maxExpiredDays]
            );
        documents.push(...result.rows.map(row => ({
          ...row,
          days_until_expiry: Number(row.days_until_expiry),
          urgency: calculateUrgency(Number(row.days_until_expiry)),
        })) as ExpiringDocument[]);
      } catch (err) {
        log.warn('ExpiringDocuments', { source: 'pipeline_approval', error: (err as Error).message });
      }
    }

    // 2. Contractor Documents
    if (!source || source === 'contractor_document') {
      try {
        const result = await client.query(
          `SELECT
            cd.id::text,
            'contractor_document' as source,
            cd.document_type,
            CONCAT(cd.document_type, ' - ', COALESCE(c.company_name, c.contact_person)) as document_name,
            cd.expiry_date,
            (cd.expiry_date::date - CURRENT_DATE)::int as days_until_expiry,
            NULL as project_id,
            NULL as project_name,
            cd.contractor_id::text,
            COALESCE(c.company_name, c.contact_person) as contractor_name,
            NULL as staff_id,
            NULL as staff_name,
            cd.file_url as document_url,
            cd.status
          FROM contractor_documents cd
          JOIN contractors c ON cd.contractor_id = c.id
          WHERE cd.expiry_date IS NOT NULL
            AND cd.expiry_date >= CURRENT_DATE - $2::int
            AND cd.expiry_date <= CURRENT_DATE + $1::int
          ORDER BY cd.expiry_date ASC`,
          [daysAhead, maxExpiredDays]
        );
        documents.push(...result.rows.map(row => ({
          ...row,
          days_until_expiry: Number(row.days_until_expiry),
          urgency: calculateUrgency(Number(row.days_until_expiry)),
        })) as ExpiringDocument[]);
      } catch (err) {
        log.warn('ExpiringDocuments', { source: 'contractor_document', error: (err as Error).message });
      }
    }

    // 3. Contractor Agreements (SOW/MBA)
    if (!source || source === 'agreement') {
      try {
        const result = projectIdStr
          ? await client.query(
              `SELECT
                ca.id::text,
                'agreement' as source,
                UPPER(ca.agreement_type) as document_type,
                CONCAT(UPPER(ca.agreement_type), ' - ', p.project_name) as document_name,
                ca.expiry_date,
                (ca.expiry_date - CURRENT_DATE)::int as days_until_expiry,
                ca.project_id::text,
                p.project_name,
                ca.contractor_id::text,
                COALESCE(c.company_name, c.contact_person) as contractor_name,
                NULL as staff_id,
                NULL as staff_name,
                ca.signed_document_url as document_url,
                ca.status
              FROM contractor_agreements ca
              JOIN projects p ON ca.project_id = p.id
              JOIN contractors c ON ca.contractor_id = c.id
              WHERE ca.expiry_date IS NOT NULL
                AND ca.expiry_date >= CURRENT_DATE - $3::int
                AND ca.expiry_date <= CURRENT_DATE + $1::int
                AND ca.status = 'active'
                AND ca.project_id = $2::uuid
              ORDER BY ca.expiry_date ASC`,
              [daysAhead, projectIdStr, maxExpiredDays]
            )
          : await client.query(
              `SELECT
                ca.id::text,
                'agreement' as source,
                UPPER(ca.agreement_type) as document_type,
                CONCAT(UPPER(ca.agreement_type), ' - ', p.project_name) as document_name,
                ca.expiry_date,
                (ca.expiry_date - CURRENT_DATE)::int as days_until_expiry,
                ca.project_id::text,
                p.project_name,
                ca.contractor_id::text,
                COALESCE(c.company_name, c.contact_person) as contractor_name,
                NULL as staff_id,
                NULL as staff_name,
                ca.signed_document_url as document_url,
                ca.status
              FROM contractor_agreements ca
              JOIN projects p ON ca.project_id = p.id
              JOIN contractors c ON ca.contractor_id = c.id
              WHERE ca.expiry_date IS NOT NULL
                AND ca.expiry_date >= CURRENT_DATE - $2::int
                AND ca.expiry_date <= CURRENT_DATE + $1::int
                AND ca.status = 'active'
              ORDER BY ca.expiry_date ASC`,
              [daysAhead, maxExpiredDays]
            );
        documents.push(...result.rows.map(row => ({
          ...row,
          days_until_expiry: Number(row.days_until_expiry),
          urgency: calculateUrgency(Number(row.days_until_expiry)),
        })) as ExpiringDocument[]);
      } catch (err) {
        log.warn('ExpiringDocuments', { source: 'agreement', error: (err as Error).message });
      }
    }

    // 4. Project Requirements with expiry
    if (!source || source === 'project_requirement') {
      try {
        const result = projectIdStr
          ? await client.query(
              `SELECT
                pr.id::text,
                'project_requirement' as source,
                pr.requirement_type as document_type,
                CONCAT(pr.requirement_name, ' - ', p.project_name) as document_name,
                pr.expiry_date,
                (pr.expiry_date - CURRENT_DATE)::int as days_until_expiry,
                pr.project_id::text,
                p.project_name,
                NULL as contractor_id,
                NULL as contractor_name,
                NULL as staff_id,
                NULL as staff_name,
                pr.document_url,
                CASE WHEN pr.is_completed THEN 'completed' ELSE 'pending' END as status
              FROM project_requirements pr
              JOIN projects p ON pr.project_id = p.id
              WHERE pr.expiry_date IS NOT NULL
                AND pr.expiry_date >= CURRENT_DATE - $3::int
                AND pr.expiry_date <= CURRENT_DATE + $1::int
                AND pr.project_id = $2::uuid
              ORDER BY pr.expiry_date ASC`,
              [daysAhead, projectIdStr, maxExpiredDays]
            )
          : await client.query(
              `SELECT
                pr.id::text,
                'project_requirement' as source,
                pr.requirement_type as document_type,
                CONCAT(pr.requirement_name, ' - ', p.project_name) as document_name,
                pr.expiry_date,
                (pr.expiry_date - CURRENT_DATE)::int as days_until_expiry,
                pr.project_id::text,
                p.project_name,
                NULL as contractor_id,
                NULL as contractor_name,
                NULL as staff_id,
                NULL as staff_name,
                pr.document_url,
                CASE WHEN pr.is_completed THEN 'completed' ELSE 'pending' END as status
              FROM project_requirements pr
              JOIN projects p ON pr.project_id = p.id
              WHERE pr.expiry_date IS NOT NULL
                AND pr.expiry_date >= CURRENT_DATE - $2::int
                AND pr.expiry_date <= CURRENT_DATE + $1::int
              ORDER BY pr.expiry_date ASC`,
              [daysAhead, maxExpiredDays]
            );
        documents.push(...result.rows.map(row => ({
          ...row,
          days_until_expiry: Number(row.days_until_expiry),
          urgency: calculateUrgency(Number(row.days_until_expiry)),
        })) as ExpiringDocument[]);
      } catch (err) {
        log.warn('ExpiringDocuments', { source: 'project_requirement', error: (err as Error).message });
      }
    }

    // 5. Staff Documents
    if (!source || source === 'staff_document') {
      try {
        const result = await client.query(
          `SELECT
            sd.id::text,
            'staff_document' as source,
            sd.document_type,
            CONCAT(sd.document_type, ' - ', COALESCE(s.first_name || ' ' || s.last_name, u.first_name || ' ' || u.last_name)) as document_name,
            sd.expiry_date,
            (sd.expiry_date::date - CURRENT_DATE)::int as days_until_expiry,
            NULL as project_id,
            NULL as project_name,
            NULL as contractor_id,
            NULL as contractor_name,
            sd.staff_id::text,
            COALESCE(s.first_name || ' ' || s.last_name, u.first_name || ' ' || u.last_name) as staff_name,
            sd.file_url as document_url,
            sd.verification_status as status
          FROM staff_documents sd
          LEFT JOIN staff s ON sd.staff_id = s.id
          LEFT JOIN users u ON sd.staff_id = u.id
          WHERE sd.expiry_date IS NOT NULL
            AND sd.expiry_date >= CURRENT_DATE - $2::int
            AND sd.expiry_date <= CURRENT_DATE + $1::int
          ORDER BY sd.expiry_date ASC`,
          [daysAhead, maxExpiredDays]
        );
        documents.push(...result.rows.map(row => ({
          ...row,
          days_until_expiry: Number(row.days_until_expiry),
          urgency: calculateUrgency(Number(row.days_until_expiry)),
        })) as ExpiringDocument[]);
      } catch (err) {
        log.warn('ExpiringDocuments', { source: 'staff_document', error: (err as Error).message });
      }
    }

    // Sort all documents by expiry date
    documents.sort((a, b) => a.days_until_expiry - b.days_until_expiry);

    // Calculate stats
    const stats: ExpiryStats = {
      total: documents.length,
      expired: documents.filter(d => d.urgency === 'expired').length,
      critical: documents.filter(d => d.urgency === 'critical').length,
      warning: documents.filter(d => d.urgency === 'warning').length,
      upcoming: documents.filter(d => d.urgency === 'upcoming').length,
    };

    // Group by urgency
    const byUrgency = {
      expired: documents.filter(d => d.urgency === 'expired'),
      critical: documents.filter(d => d.urgency === 'critical'),
      warning: documents.filter(d => d.urgency === 'warning'),
      upcoming: documents.filter(d => d.urgency === 'upcoming'),
    };

    // Group by source
    const bySource = {
      pipeline_approval: documents.filter(d => d.source === 'pipeline_approval'),
      contractor_document: documents.filter(d => d.source === 'contractor_document'),
      agreement: documents.filter(d => d.source === 'agreement'),
      project_requirement: documents.filter(d => d.source === 'project_requirement'),
      staff_document: documents.filter(d => d.source === 'staff_document'),
    };

    log.info('ExpiringDocuments', {
      days: daysAhead,
      total: stats.total,
      expired: stats.expired,
      critical: stats.critical,
    });

    return apiResponse.success(res, {
      stats,
      by_urgency: byUrgency,
      by_source: bySource,
      all: documents,
    });
  } catch (error) {
    log.error('ExpiringDocuments', { error: (error as Error).message });
    return apiResponse.internalError(res, error as Error);
  } finally {
    client.release();
  }
}

export default withAuth(handler);
