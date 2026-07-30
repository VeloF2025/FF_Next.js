import type { PoolClient } from 'pg';
import type { ZoneKey } from '../types/zoneDelivery.types';
import type {
  DocumentRow,
  PonStateRow,
  SnagLinkRow,
  ZoneAggregate,
  ZoneStateRow,
} from './zoneDeliveryReadRepository';

interface RegisterPonRow extends PonStateRow {
  project_id: string;
  zone_no: number;
  project_name: string;
}

interface RegisterDocumentRow extends DocumentRow {
  project_id: string;
  zone_no: number;
}

interface RegisterSnagRow extends SnagLinkRow {
  project_id: string;
  zone_no: number;
}

const aggregateKey = (key: ZoneKey): string => `${key.projectId}:${key.zoneNo}`;

export async function readRegisterAggregates(
  client: PoolClient,
  projectId?: string,
  zoneNo?: number,
): Promise<ZoneAggregate[]> {
  const params = [projectId ?? null, zoneNo ?? null];
  const [pons, zones, documents, snagLinks] = await Promise.all([
    client.query<RegisterPonRow>(`
      SELECT p.project_id, p.zone_no, projects.project_name,
        p.id AS pon_stage_id, p.pon_no,
        COALESCE(s.scope_status, 'included') AS scope_status, s.scope_reason,
        EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'civil'
        ) AND NOT EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'civil'
            AND q.workflow_status <> 'approved'
        ) AS civil_qa_approved,
        EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'optical'
        ) AND NOT EXISTS (
          SELECT 1 FROM construction_qa_reviews q
          WHERE q.project_id = p.project_id AND q.zone_no = p.zone_no
            AND q.pon_no = p.pon_no AND q.discipline = 'optical'
            AND q.workflow_status <> 'approved'
        ) AS optical_qa_approved,
        s.civil_complete_at, s.civil_confirmed_by,
        s.optical_complete_at, s.optical_confirmed_by,
        s.testing_passed_at, s.testing_confirmed_by,
        s.testing_test_pack_document_id,
        s.port_submitted_at, s.port_submitted_by,
        s.port_approved_at, s.port_approved_by,
        s.technically_live_at, s.technically_live_by,
        COALESCE(s.row_version, 0) AS row_version
      FROM pon_stage_tracking p
      JOIN projects ON projects.id = p.project_id
      LEFT JOIN pon_delivery_state s ON s.pon_stage_id = p.id
      WHERE ($1::uuid IS NULL OR p.project_id = $1)
        AND ($2::integer IS NULL OR p.zone_no = $2)
      ORDER BY p.project_id, p.zone_no, p.pon_no
    `, params),
    client.query<ZoneStateRow>(`
      SELECT z.*
      FROM zone_delivery_state z
      WHERE ($1::uuid IS NULL OR z.project_id = $1)
        AND ($2::integer IS NULL OR z.zone_no = $2)
        AND EXISTS (
          SELECT 1 FROM pon_stage_tracking p
          WHERE p.project_id = z.project_id AND p.zone_no = z.zone_no
        )
    `, params),
    client.query<RegisterDocumentRow>(`
      SELECT d.*
      FROM zone_delivery_documents d
      WHERE ($1::uuid IS NULL OR d.project_id = $1)
        AND ($2::integer IS NULL OR d.zone_no = $2)
      ORDER BY d.uploaded_at, d.id
    `, params),
    client.query<RegisterSnagRow>(`
      SELECT l.project_id, l.zone_no, l.snag_id, l.pon_stage_id,
        l.affected_gate, l.qa_discipline, l.handover_blocking,
        l.requires_reconfirmation, l.reconfirmed_at, s.status, s.closed_at
      FROM zone_delivery_snag_links l
      JOIN snags s ON s.id = l.snag_id
      WHERE ($1::uuid IS NULL OR l.project_id = $1)
        AND ($2::integer IS NULL OR l.zone_no = $2)
      ORDER BY l.linked_at, l.snag_id
    `, params),
  ]);

  const aggregates = new Map<string, ZoneAggregate>();
  for (const pon of pons.rows) {
    const key = { projectId: pon.project_id, zoneNo: pon.zone_no };
    const id = aggregateKey(key);
    const aggregate = aggregates.get(id) ?? {
      key,
      projectName: pon.project_name,
      zone: null,
      pons: [],
      documents: [],
      snagLinks: [],
      activities: [],
    };
    aggregate.pons.push(pon);
    aggregates.set(id, aggregate);
  }
  for (const zone of zones.rows) {
    const aggregate = aggregates.get(aggregateKey({
      projectId: zone.project_id,
      zoneNo: zone.zone_no,
    }));
    if (aggregate) aggregate.zone = zone;
  }
  for (const document of documents.rows) {
    aggregates.get(aggregateKey({
      projectId: document.project_id,
      zoneNo: document.zone_no,
    }))?.documents.push(document);
  }
  for (const snag of snagLinks.rows) {
    aggregates.get(aggregateKey({
      projectId: snag.project_id,
      zoneNo: snag.zone_no,
    }))?.snagLinks.push(snag);
  }
  return [...aggregates.values()];
}
