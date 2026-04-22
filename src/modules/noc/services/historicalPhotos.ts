/**
 * Historical Photos aggregator for NOC tickets.
 *
 * Given a ticket with a dr_number and/or pole_number, gathers photos from
 * every relevant source and returns them grouped by source. Each source
 * runs in parallel via Promise.allSettled so a slow/failing source never
 * blocks the others — callers surface per-group errors to the UI.
 */

import { createLogger } from '@/lib/logger';
import { sql } from '@/lib/neon';
import { fetchPhotosWithFallback } from '@/services/activate/photoSources';
import { STEP_LABELS } from '@/modules/activate/utils/stepMapper';
import type { Ticket } from '@/modules/noc/types/ticket';

const logger = createLogger('noc:historical-photos');

export type HistoricalPhotoGroupKey =
  | 'activate_qa'
  | 'wa_qa'
  | 'construction_qa'
  | 'sow_poles'
  | 'qfield_raw';

export interface HistoricalPhoto {
  url: string;
  thumbnailUrl?: string;
  label: string;
  metadata?: string;
  capturedAt?: string | null;
  stepNumber?: number | null;
}

export interface HistoricalPhotoGroup {
  key: HistoricalPhotoGroupKey;
  label: string;
  entity: 'dr' | 'pole';
  entityId: string;
  count: number;
  photos: HistoricalPhoto[];
  error?: string;
}

export interface HistoricalPhotosPayload {
  drNumber: string | null;
  poleNumber: string | null;
  groups: HistoricalPhotoGroup[];
}

const GROUP_LABEL: Record<HistoricalPhotoGroupKey, string> = {
  activate_qa: 'Activate QA (OneMap/BOSS)',
  wa_qa: 'WhatsApp QA',
  construction_qa: 'Construction QA',
  sow_poles: 'SOW Pole Photos',
  qfield_raw: 'QField Validations',
};

type TicketLike = Pick<Ticket, 'dr_number' | 'pole_number'>;

interface ResolvedIds {
  drNumber: string | null;
  poleNumber: string | null;
}

async function resolvePoleFromDrop(drNumber: string): Promise<string | null> {
  try {
    const rows = (await sql`
      SELECT pole_number FROM drops WHERE drop_number = ${drNumber} LIMIT 1
    `) as unknown as Array<{ pole_number: string | null }>;
    return rows[0]?.pole_number ?? null;
  } catch (error) {
    logger.warn('Failed to resolve pole_number from drops', { drNumber, error });
    return null;
  }
}

async function resolveIds(ticket: TicketLike): Promise<ResolvedIds> {
  const drNumber = ticket.dr_number ?? null;
  let poleNumber = ticket.pole_number ?? null;

  if (drNumber && !poleNumber) {
    poleNumber = await resolvePoleFromDrop(drNumber);
  }

  return { drNumber, poleNumber };
}

async function gatherActivateQa(drNumber: string): Promise<HistoricalPhotoGroup> {
  const base: HistoricalPhotoGroup = {
    key: 'activate_qa',
    label: GROUP_LABEL.activate_qa,
    entity: 'dr',
    entityId: drNumber,
    count: 0,
    photos: [],
  };

  const result = await fetchPhotosWithFallback(drNumber);
  const photos: HistoricalPhoto[] = result.photos.map((p) => {
    const stepLabel = p.step && STEP_LABELS[p.step] ? STEP_LABELS[p.step] : null;
    const metaParts = [
      stepLabel ? `Step ${p.step}: ${stepLabel}` : null,
      p.original_type ? `Type: ${p.original_type}` : null,
      `Source: ${result.source}`,
    ].filter(Boolean) as string[];
    return {
      url: p.url,
      label: p.filename,
      metadata: metaParts.join(' · '),
      stepNumber: p.step,
    };
  });

  return { ...base, count: photos.length, photos };
}

async function gatherWaQa(drNumber: string): Promise<HistoricalPhotoGroup> {
  const base: HistoricalPhotoGroup = {
    key: 'wa_qa',
    label: GROUP_LABEL.wa_qa,
    entity: 'dr',
    entityId: drNumber,
    count: 0,
    photos: [],
  };

  const rows = (await sql`
    SELECT
      id,
      sender_name,
      message_timestamp,
      original_filename,
      local_path,
      mime_type,
      vlm_ont_serial,
      vlm_ups_serial
    FROM wa_photos
    WHERE drop_number = ${drNumber.toUpperCase()}
      AND purpose = 'activation'
    ORDER BY message_timestamp DESC, photo_index ASC
  `) as unknown as Array<{
    id: string;
    sender_name: string | null;
    message_timestamp: string;
    original_filename: string | null;
    local_path: string | null;
    mime_type: string | null;
    vlm_ont_serial: string | null;
    vlm_ups_serial: string | null;
  }>;

  const photos: HistoricalPhoto[] = rows
    .map((row): HistoricalPhoto | null => {
      if (!row.local_path) return null;
      const parts = row.local_path.split('/');
      const filename = parts[parts.length - 1];
      const drFolder = parts[parts.length - 2];
      if (!filename || !drFolder) return null;

      const metaParts = [
        row.sender_name ? `From: ${row.sender_name}` : null,
        row.vlm_ont_serial ? `ONT: ${row.vlm_ont_serial}` : null,
        row.vlm_ups_serial ? `UPS: ${row.vlm_ups_serial}` : null,
      ].filter(Boolean) as string[];

      return {
        url: `/api/activate/photo/${drFolder}/${filename}`,
        label: row.original_filename ?? filename,
        metadata: metaParts.length > 0 ? metaParts.join(' · ') : undefined,
        capturedAt: row.message_timestamp,
      };
    })
    .filter((p): p is HistoricalPhoto => p !== null);

  return { ...base, count: photos.length, photos };
}

async function gatherConstructionQa(poleNumber: string): Promise<HistoricalPhotoGroup> {
  const base: HistoricalPhotoGroup = {
    key: 'construction_qa',
    label: GROUP_LABEL.construction_qa,
    entity: 'pole',
    entityId: poleNumber,
    count: 0,
    photos: [],
  };

  const rows = (await sql`
    SELECT
      p.id,
      p.source,
      p.storage_key,
      p.filename,
      p.mime_type,
      p.checklist_step,
      p.step_label,
      p.captured_at,
      p.vlm_confidence,
      p.manual_status
    FROM construction_qa_photos p
    INNER JOIN construction_qa_reviews r ON p.review_id = r.id
    WHERE r.feature_type = 'pole'
      AND r.feature_id = ${poleNumber}
    ORDER BY p.captured_at DESC NULLS LAST, p.created_at DESC
  `) as unknown as Array<{
    id: string;
    source: string;
    storage_key: string;
    filename: string | null;
    mime_type: string | null;
    checklist_step: number | null;
    step_label: string | null;
    captured_at: string | null;
    vlm_confidence: number | null;
    manual_status: string | null;
  }>;

  const photos: HistoricalPhoto[] = rows.map((row) => {
    const encodedKey = encodeURIComponent(row.storage_key);
    const encodedSource = encodeURIComponent(row.source);
    const metaParts = [
      row.step_label ? `Step: ${row.step_label}` : row.checklist_step ? `Step ${row.checklist_step}` : null,
      row.manual_status && row.manual_status !== 'pending' ? `Review: ${row.manual_status}` : null,
      typeof row.vlm_confidence === 'number' ? `VLM: ${Math.round(row.vlm_confidence * 100)}%` : null,
      `Source: ${row.source}`,
    ].filter(Boolean) as string[];
    return {
      url: `/api/construction-qa/photo-proxy?key=${encodedKey}&source=${encodedSource}`,
      label: row.filename ?? row.storage_key.split('/').pop() ?? 'photo',
      metadata: metaParts.join(' · '),
      capturedAt: row.captured_at,
      stepNumber: row.checklist_step,
    };
  });

  return { ...base, count: photos.length, photos };
}

async function gatherSowPoles(poleNumber: string): Promise<HistoricalPhotoGroup> {
  const base: HistoricalPhotoGroup = {
    key: 'sow_poles',
    label: GROUP_LABEL.sow_poles,
    entity: 'pole',
    entityId: poleNumber,
    count: 0,
    photos: [],
  };

  const rows = (await sql`
    SELECT
      id,
      pole_number,
      photo_before,
      photo_during,
      photo_after,
      photo_label,
      photo_cable_routing,
      photo_quality_check,
      updated_at
    FROM poles
    WHERE pole_number = ${poleNumber}
    LIMIT 1
  `) as unknown as Array<{
    id: number;
    pole_number: string;
    photo_before: string | null;
    photo_during: string | null;
    photo_after: string | null;
    photo_label: string | null;
    photo_cable_routing: string | null;
    photo_quality_check: string | null;
    updated_at: string | null;
  }>;

  const row = rows[0];
  if (!row) return base;

  const typeLabels: Array<[keyof typeof row, string]> = [
    ['photo_before', 'Before'],
    ['photo_during', 'During'],
    ['photo_after', 'After'],
    ['photo_label', 'Label'],
    ['photo_cable_routing', 'Cable Routing'],
    ['photo_quality_check', 'Quality Check'],
  ];

  const photos: HistoricalPhoto[] = typeLabels
    .map(([field, label]): HistoricalPhoto | null => {
      const url = row[field] as string | null;
      if (!url) return null;
      return {
        url,
        label,
        metadata: `Type: ${label} · Source: VF Storage`,
        capturedAt: row.updated_at,
      };
    })
    .filter((p): p is HistoricalPhoto => p !== null);

  return { ...base, count: photos.length, photos };
}

async function gatherQfieldRaw(poleNumber: string): Promise<HistoricalPhotoGroup> {
  const base: HistoricalPhotoGroup = {
    key: 'qfield_raw',
    label: GROUP_LABEL.qfield_raw,
    entity: 'pole',
    entityId: poleNumber,
    count: 0,
    photos: [],
  };

  const rows = (await sql`
    SELECT
      id,
      photo_key,
      feature_id,
      feature_type,
      work_type,
      vlm_confidence,
      validated_at,
      created_at
    FROM qfield_photo_validations
    WHERE feature_id = ${poleNumber}
      AND feature_type = 'pole'
    ORDER BY created_at DESC
  `) as unknown as Array<{
    id: string;
    photo_key: string;
    feature_id: string;
    feature_type: string;
    work_type: string | null;
    vlm_confidence: number | null;
    validated_at: string | null;
    created_at: string;
  }>;

  const photos: HistoricalPhoto[] = rows.map((row) => {
    const encodedKey = encodeURIComponent(row.photo_key);
    const filename = row.photo_key.split('/').pop() ?? row.photo_key;
    const metaParts = [
      row.work_type ? `Work: ${row.work_type}` : null,
      typeof row.vlm_confidence === 'number' ? `VLM: ${Math.round(row.vlm_confidence * 100)}%` : null,
      row.validated_at ? 'Validated' : 'Pending validation',
    ].filter(Boolean) as string[];
    return {
      url: `/api/qfield/photo-proxy?key=${encodedKey}`,
      label: filename,
      metadata: metaParts.join(' · '),
      capturedAt: row.created_at,
    };
  });

  return { ...base, count: photos.length, photos };
}

async function runSource(
  key: HistoricalPhotoGroupKey,
  entity: 'dr' | 'pole',
  entityId: string,
  fn: () => Promise<HistoricalPhotoGroup>
): Promise<HistoricalPhotoGroup> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Historical photo source '${key}' failed`, { entityId, error: message });
    return {
      key,
      label: GROUP_LABEL[key],
      entity,
      entityId,
      count: 0,
      photos: [],
      error: message,
    };
  }
}

/**
 * Primary entry point — gathers every applicable photo source for a ticket.
 */
export async function gatherHistoricalPhotos(ticket: TicketLike): Promise<HistoricalPhotosPayload> {
  const { drNumber, poleNumber } = await resolveIds(ticket);

  const tasks: Array<Promise<HistoricalPhotoGroup>> = [];

  if (drNumber) {
    tasks.push(runSource('activate_qa', 'dr', drNumber, () => gatherActivateQa(drNumber)));
    tasks.push(runSource('wa_qa', 'dr', drNumber, () => gatherWaQa(drNumber)));
  }
  if (poleNumber) {
    tasks.push(runSource('construction_qa', 'pole', poleNumber, () => gatherConstructionQa(poleNumber)));
    tasks.push(runSource('sow_poles', 'pole', poleNumber, () => gatherSowPoles(poleNumber)));
    tasks.push(runSource('qfield_raw', 'pole', poleNumber, () => gatherQfieldRaw(poleNumber)));
  }

  const settled = await Promise.allSettled(tasks);
  const groups: HistoricalPhotoGroup[] = settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          key: 'activate_qa',
          label: 'Unknown source',
          entity: 'dr',
          entityId: '',
          count: 0,
          photos: [],
          error: String(s.reason),
        }
  );

  return { drNumber, poleNumber, groups };
}
