/**
 * Staff Disciplinary API
 * GET /api/staff/[staffId]/disciplinary - Get all disciplinary incidents
 * POST /api/staff/[staffId]/disciplinary - Create new disciplinary incident
 * PUT /api/staff/[staffId]/disciplinary?id=xxx - Update disciplinary incident
 * DELETE /api/staff/[staffId]/disciplinary?id=xxx - Delete disciplinary incident
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withArcjetProtection, aj } from '@/lib/arcjet';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type {
  DisciplinaryIncident,
  DisciplinaryIncidentCreate,
  DisciplinaryIncidentUpdate,
} from '@/types/staff';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffDisciplinaryAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { staffId, id } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  // GET - Fetch disciplinary incidents
  if (req.method === 'GET') {
    try {
      const incidents = await sql`
        SELECT
          d.*,
          CONCAT(i.first_name, ' ', i.last_name) as issued_by_name,
          i.position as issued_by_position
        FROM disciplinary_incidents d
        LEFT JOIN staff i ON i.id = d.issued_by
        WHERE d.staff_id = ${staffId}
        ORDER BY d.incident_date DESC, d.created_at DESC
      `;

      // Fetch witnesses for each incident
      const incidentsWithWitnesses = await Promise.all(
        incidents.map(async (incident) => {
          let witnesses: Array<{ id: string; name: string }> = [];
          if (incident.witness_ids && incident.witness_ids.length > 0) {
            const witnessData = await sql`
              SELECT id, CONCAT(first_name, ' ', last_name) as name
              FROM staff
              WHERE id = ANY(${incident.witness_ids})
            `;
            witnesses = witnessData.map((w) => ({
              id: w.id as string,
              name: w.name as string,
            }));
          }
          return mapDbToIncident(incident, witnesses);
        })
      );

      return res.status(200).json({
        success: true,
        incidents: incidentsWithWitnesses,
        count: incidentsWithWitnesses.length,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch disciplinary incidents', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to fetch disciplinary incidents', message: errorMessage });
    }
  }

  // POST - Create disciplinary incident
  if (req.method === 'POST') {
    try {
      const body = req.body as DisciplinaryIncidentCreate;

      if (!body.incidentDate || !body.incidentType || !body.description) {
        return res.status(400).json({ error: 'Incident date, type, and description are required' });
      }

      const [created] = await sql`
        INSERT INTO disciplinary_incidents (
          staff_id,
          incident_date,
          incident_type,
          description,
          outcome,
          issued_by,
          witness_ids,
          follow_up_date,
          follow_up_notes,
          attachments
        ) VALUES (
          ${staffId},
          ${body.incidentDate},
          ${body.incidentType},
          ${body.description},
          ${body.outcome || 'pending'},
          ${body.issuedBy || null},
          ${body.witnessIds || []},
          ${body.followUpDate || null},
          ${body.followUpNotes || null},
          ${JSON.stringify(body.attachments || [])}
        )
        RETURNING *
      `;

      if (!created) {
        return res.status(500).json({ error: 'Failed to create disciplinary incident' });
      }

      logger.info('Disciplinary incident created', { staffId, incidentId: created.id });

      // Fetch with joins
      const [incident] = await sql`
        SELECT
          d.*,
          CONCAT(i.first_name, ' ', i.last_name) as issued_by_name,
          i.position as issued_by_position
        FROM disciplinary_incidents d
        LEFT JOIN staff i ON i.id = d.issued_by
        WHERE d.id = ${created.id}
      `;

      return res.status(201).json({
        success: true,
        incident: incident ? mapDbToIncident(incident as Record<string, unknown>, []) : null,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create disciplinary incident', { staffId, error: errorMessage });
      return res.status(500).json({ error: 'Failed to create disciplinary incident', message: errorMessage });
    }
  }

  // PUT - Update disciplinary incident
  if (req.method === 'PUT') {
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Incident ID is required' });
    }

    try {
      const body = req.body as DisciplinaryIncidentUpdate;

      // Verify incident belongs to staff member
      const [existing] = await sql`
        SELECT id FROM disciplinary_incidents
        WHERE id = ${id} AND staff_id = ${staffId}
      `;

      if (!existing) {
        return res.status(404).json({ error: 'Disciplinary incident not found' });
      }

      const [updated] = await sql`
        UPDATE disciplinary_incidents
        SET
          incident_date = COALESCE(${body.incidentDate || null}, incident_date),
          incident_type = COALESCE(${body.incidentType || null}, incident_type),
          description = COALESCE(${body.description || null}, description),
          outcome = COALESCE(${body.outcome || null}, outcome),
          issued_by = COALESCE(${body.issuedBy || null}, issued_by),
          witness_ids = COALESCE(${body.witnessIds || null}, witness_ids),
          follow_up_date = COALESCE(${body.followUpDate || null}, follow_up_date),
          follow_up_notes = COALESCE(${body.followUpNotes || null}, follow_up_notes),
          is_resolved = COALESCE(${body.isResolved ?? null}, is_resolved),
          resolved_date = COALESCE(${body.resolvedDate || null}, resolved_date),
          attachments = COALESCE(${body.attachments ? JSON.stringify(body.attachments) : null}, attachments),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (!updated) {
        return res.status(500).json({ error: 'Failed to update disciplinary incident' });
      }

      logger.info('Disciplinary incident updated', { staffId, incidentId: id });

      // Fetch with joins
      const [incident] = await sql`
        SELECT
          d.*,
          CONCAT(i.first_name, ' ', i.last_name) as issued_by_name,
          i.position as issued_by_position
        FROM disciplinary_incidents d
        LEFT JOIN staff i ON i.id = d.issued_by
        WHERE d.id = ${updated.id}
      `;

      return res.status(200).json({
        success: true,
        incident: incident ? mapDbToIncident(incident as Record<string, unknown>, []) : null,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update disciplinary incident', { staffId, id, error: errorMessage });
      return res.status(500).json({ error: 'Failed to update disciplinary incident', message: errorMessage });
    }
  }

  // DELETE - Delete disciplinary incident
  if (req.method === 'DELETE') {
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Incident ID is required' });
    }

    try {
      // Verify incident belongs to staff member
      const [existing] = await sql`
        SELECT id FROM disciplinary_incidents
        WHERE id = ${id} AND staff_id = ${staffId}
      `;

      if (!existing) {
        return res.status(404).json({ error: 'Disciplinary incident not found' });
      }

      await sql`DELETE FROM disciplinary_incidents WHERE id = ${id}`;

      logger.info('Disciplinary incident deleted', { staffId, incidentId: id });

      return res.status(200).json({
        success: true,
        message: 'Disciplinary incident deleted',
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to delete disciplinary incident', { staffId, id, error: errorMessage });
      return res.status(500).json({ error: 'Failed to delete disciplinary incident', message: errorMessage });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAuth(withArcjetProtection(handler, aj));

// Map database row to DisciplinaryIncident interface
function mapDbToIncident(
  row: Record<string, unknown>,
  witnesses: Array<{ id: string; name: string }>
): DisciplinaryIncident {
  return {
    id: row.id as string,
    staffId: row.staff_id as string,
    incidentDate: (row.incident_date
      ? new Date(row.incident_date as string).toISOString().split('T')[0]
      : '') as string,
    incidentType: row.incident_type as DisciplinaryIncident['incidentType'],
    description: row.description as string,
    outcome: row.outcome as DisciplinaryIncident['outcome'],
    issuedBy: row.issued_by as string | undefined,
    witnessIds: (row.witness_ids as string[]) || [],
    followUpDate: row.follow_up_date
      ? new Date(row.follow_up_date as string).toISOString().split('T')[0]
      : undefined,
    followUpNotes: row.follow_up_notes as string | undefined,
    isResolved: row.is_resolved as boolean,
    resolvedDate: row.resolved_date
      ? new Date(row.resolved_date as string).toISOString().split('T')[0]
      : undefined,
    attachments: typeof row.attachments === 'string'
      ? JSON.parse(row.attachments)
      : (row.attachments as DisciplinaryIncident['attachments']) || [],
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    issuedByStaff: row.issued_by_name
      ? {
          id: row.issued_by as string,
          name: row.issued_by_name as string,
          position: row.issued_by_position as string | undefined,
        }
      : undefined,
    witnesses,
  };
}
