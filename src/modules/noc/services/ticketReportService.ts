/**
 * ticketReportService — assemble the data payload for the NOC ticket
 * report PDF.
 *
 * Fetches the ticket, verification steps, all evidence photos (with AI
 * captions from `reportCaptionService`), notes, and timeline activity in
 * one server-side pass. The result is ticket-shape-agnostic: the PDF
 * renderer doesn't need to know about any specific step template.
 */

import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import {
  generateCaptionsForTicket,
  generateStepNarrativesForTicket,
  type CaptionContext,
  type CaptionResult,
  type StepNarrativeResult,
} from './reportCaptionService';

const logger = createLogger('noc:ticket-report');

export interface BuildTicketReportOptions {
  /**
   * Clear cached VLM captions for this ticket and re-run the VLM pass from
   * scratch. Use when the prompts or tone have been changed and previous
   * captions need to be refreshed.
   */
  regenerateCaptions?: boolean;
}

export interface ReportPhoto {
  id: string;
  url: string;
  filename: string;
  uploadedAt: string;
  aiCaption: string;
  aiContext: CaptionContext;
  aiConfidence: 'high' | 'medium' | 'low';
}

export interface ReportVerificationStep {
  id: string;
  stepNumber: number;
  stepName: string;
  stepDescription: string | null;
  isComplete: boolean;
  completedAt: string | null;
  completedByName: string | null;
  photoRequired: boolean;
  notes: string | null;
  photos: ReportPhoto[];
  /** Multi-photo workflow summary produced by the VLM when the step has 2+ photos. */
  aiNarrative: string | null;
  aiNarrativeConfidence: 'high' | 'medium' | 'low' | null;
}

export interface ReportNote {
  content: string;
  noteType: string | null;
  createdByName: string | null;
  createdAt: string;
  isResolution: boolean;
}

export interface ReportActivity {
  activityType: string;
  description: string | null;
  createdByName: string | null;
  createdAt: string;
  fieldChanges: Record<string, unknown> | null;
}

export interface TicketReportData {
  generatedAt: string;

  ticket: {
    id: string;
    ticketUid: string;
    title: string;
    description: string | null;
    type: string | null;
    category: string | null;
    subcategory: string | null;
    status: string;
    priority: string;
    source: string;
    projectName: string | null;
    drNumber: string | null;
    clientName: string | null;
    clientContact: string | null;
    address: string | null;
    gpsCoordinates: string | null;
    zone: string | null;
    pon: string | null;
    assignedUserName: string | null;
    assignedTeamName: string | null;
    createdByName: string | null;
    createdAt: string;
    resolvedAt: string | null;
    closedAt: string | null;
    slaBreached: boolean;
    tags: string[] | null;
  };

  steps: ReportVerificationStep[];
  /** Attachments that don't belong to any verification step (ticket-level evidence). */
  generalPhotos: ReportPhoto[];
  notes: ReportNote[];
  /** Short activity timeline — creation, assignment, status changes, resolution. */
  activity: ReportActivity[];
}

interface TicketRow {
  id: string;
  ticket_uid: string;
  title: string;
  description: string | null;
  type: string | null;
  category: string | null;
  subcategory: string | null;
  status: string;
  priority: string;
  source: string;
  project_id: string | null;
  dr_number: string | null;
  client_name: string | null;
  client_contact: string | null;
  address: string | null;
  gps_coordinates: string | null;
  zone: string | null;
  pon: string | null;
  assigned_team_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  sla_breached: boolean;
  tags: string[] | null;
  assigned_user_name: string | null;
  assigned_team_name: string | null;
  created_by_name: string | null;
  project_name: string | null;
}

interface StepRow {
  id: string;
  step_number: number;
  step_name: string;
  step_description: string | null;
  is_complete: boolean;
  completed_at: string | null;
  completed_by_name: string | null;
  photo_required: boolean;
  notes: string | null;
}

interface AttachmentRow {
  id: string;
  verification_step_id: string | null;
  storage_url: string | null;
  file_url: string | null;
  filename: string;
  uploaded_at: string;
}

interface NoteRow {
  content: string;
  note_type: string | null;
  is_resolution: boolean;
  created_at: string;
  created_by_name: string | null;
}

interface ActivityRow {
  activity_type: string;
  description: string | null;
  created_at: string;
  created_by_name: string | null;
  field_changes: Record<string, unknown> | null;
}

export async function buildTicketReportData(
  ticketId: string,
  options: BuildTicketReportOptions = {}
): Promise<TicketReportData> {
  const ticket = await queryOne<TicketRow>(
    `
    SELECT t.id, t.ticket_uid, t.title, t.description, t.type, t.category, t.subcategory,
           t.status, t.priority, t.source, t.project_id, t.dr_number,
           t.client_name, t.client_contact, t.address, t.gps_coordinates,
           t.zone, t.pon, t.assigned_team_id, t.assigned_to, t.created_by,
           t.created_at, t.resolved_at, t.closed_at, t.sla_breached, t.tags,
           COALESCE(assigned_staff.first_name || ' ' || assigned_staff.last_name, assigned_staff.email) AS assigned_user_name,
           tm.name AS assigned_team_name,
           COALESCE(created_user.first_name || ' ' || created_user.last_name, created_user.email) AS created_by_name,
           p.project_name AS project_name
    FROM maintenance_tickets t
    LEFT JOIN staff assigned_staff ON assigned_staff.id = t.assigned_to
    LEFT JOIN teams tm ON tm.id = t.assigned_team_id
    LEFT JOIN users created_user ON created_user.id = t.created_by
    LEFT JOIN projects p ON p.id::text = t.project_id
    WHERE t.id = $1
    `,
    [ticketId]
  );

  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  // First DB pass — everything except AI work. Notes are needed as ground
  // truth for the VLM prompts, so they have to land before the caption call.
  const [steps, attachments, notes, activity] = await Promise.all([
    query<StepRow>(
      `
      SELECT s.id, s.step_number, s.step_name, s.step_description,
             s.is_complete, s.completed_at, s.photo_required, s.notes,
             COALESCE(u.first_name || ' ' || u.last_name, u.email) AS completed_by_name
      FROM maintenance_verification_steps s
      LEFT JOIN users u ON u.id = s.completed_by
      WHERE s.ticket_id = $1
      ORDER BY s.step_number ASC
      `,
      [ticketId]
    ),
    query<AttachmentRow>(
      `
      SELECT id, verification_step_id, storage_url, file_url, filename, uploaded_at
      FROM maintenance_attachments
      WHERE ticket_id = $1
        AND is_evidence = true
        AND COALESCE(mime_type, '') LIKE 'image/%'
      ORDER BY uploaded_at ASC
      `,
      [ticketId]
    ),
    query<NoteRow>(
      `
      SELECT n.content, n.note_type, n.is_resolution, n.created_at,
             COALESCE(u.first_name || ' ' || u.last_name, u.email) AS created_by_name
      FROM maintenance_notes n
      LEFT JOIN users u ON u.id = n.created_by
      WHERE n.ticket_id = $1
      ORDER BY n.created_at ASC
      `,
      [ticketId]
    ),
    query<ActivityRow>(
      `
      SELECT activity_type, description, created_at, created_by_name, field_changes
      FROM maintenance_activities
      WHERE ticket_id = $1
      ORDER BY created_at ASC
      LIMIT 100
      `,
      [ticketId]
    ),
  ]);

  // Build the shared VLM context once — ticket title + description + the
  // human-written notes. Resolution notes (is_resolution=true) become
  // ground-truth that the VLM prefers over its own visual guesses.
  const captionContext = {
    title: ticket.title,
    description: ticket.description,
    ticketType: ticket.type,
    resolutionNotes: notes
      .filter((n) => n.is_resolution && n.content?.trim())
      .map((n) => ({ content: n.content, author: n.created_by_name })),
    otherNotes: notes
      .filter((n) => !n.is_resolution && n.content?.trim())
      .map((n) => ({ content: n.content, author: n.created_by_name })),
  };

  const captions = await generateCaptionsForTicket(ticketId, {
    ticket: captionContext,
    regenerate: options.regenerateCaptions,
  });

  // Step narratives run after per-photo captions so the VLM server isn't hit
  // by both passes in parallel (and so we can reuse the same ticket context).
  const narratives = await generateStepNarrativesForTicket(ticketId, {
    ticket: captionContext,
    regenerate: options.regenerateCaptions,
  });

  logger.info('Ticket report data assembled', {
    ticketId,
    ticketUid: ticket.ticket_uid,
    steps: steps.length,
    photos: attachments.length,
    notes: notes.length,
    activityEvents: activity.length,
    narratives: narratives.size,
  });

  return shapeReport({ ticket, steps, attachments, notes, activity, captions, narratives });
}

function shapeReport(args: {
  ticket: TicketRow;
  steps: StepRow[];
  attachments: AttachmentRow[];
  notes: NoteRow[];
  activity: ActivityRow[];
  captions: Map<string, CaptionResult>;
  narratives: Map<string, StepNarrativeResult>;
}): TicketReportData {
  const { ticket, steps, attachments, notes, activity, captions, narratives } = args;

  const attachmentToPhoto = (a: AttachmentRow): ReportPhoto => {
    const caption = captions.get(a.id);
    const context: CaptionContext = caption?.context ?? 'general';
    return {
      id: a.id,
      url: (a.storage_url || a.file_url || '').trim(),
      filename: a.filename,
      uploadedAt: a.uploaded_at,
      aiCaption:
        caption?.caption ||
        'AI description unavailable — reviewer should describe manually.',
      aiContext: context,
      aiConfidence: caption?.confidence ?? 'low',
    };
  };

  const photosByStep = new Map<string, ReportPhoto[]>();
  const generalPhotos: ReportPhoto[] = [];
  for (const a of attachments) {
    const photo = attachmentToPhoto(a);
    if (!photo.url) continue;
    if (a.verification_step_id) {
      const arr = photosByStep.get(a.verification_step_id) ?? [];
      arr.push(photo);
      photosByStep.set(a.verification_step_id, arr);
    } else {
      generalPhotos.push(photo);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    ticket: {
      id: ticket.id,
      ticketUid: ticket.ticket_uid,
      title: ticket.title,
      description: ticket.description,
      type: ticket.type,
      category: ticket.category,
      subcategory: ticket.subcategory,
      status: ticket.status,
      priority: ticket.priority,
      source: ticket.source,
      projectName: ticket.project_name,
      drNumber: ticket.dr_number,
      clientName: ticket.client_name,
      clientContact: ticket.client_contact,
      address: ticket.address,
      gpsCoordinates: ticket.gps_coordinates,
      zone: ticket.zone,
      pon: ticket.pon,
      assignedUserName: ticket.assigned_user_name,
      assignedTeamName: ticket.assigned_team_name,
      createdByName: ticket.created_by_name,
      createdAt: ticket.created_at,
      resolvedAt: ticket.resolved_at,
      closedAt: ticket.closed_at,
      slaBreached: ticket.sla_breached,
      tags: ticket.tags,
    },
    steps: steps.map((s) => {
      const narrative = narratives.get(s.id);
      return {
        id: s.id,
        stepNumber: s.step_number,
        stepName: s.step_name,
        stepDescription: s.step_description,
        isComplete: s.is_complete,
        completedAt: s.completed_at,
        completedByName: s.completed_by_name,
        photoRequired: s.photo_required,
        notes: s.notes,
        photos: photosByStep.get(s.id) ?? [],
        aiNarrative: narrative?.narrative ?? null,
        aiNarrativeConfidence: narrative?.confidence ?? null,
      };
    }),
    generalPhotos,
    notes: notes.map((n) => ({
      content: n.content,
      noteType: n.note_type,
      createdByName: n.created_by_name,
      createdAt: n.created_at,
      isResolution: n.is_resolution,
    })),
    activity: activity.map((a) => ({
      activityType: a.activity_type,
      description: a.description,
      createdByName: a.created_by_name,
      createdAt: a.created_at,
      fieldChanges: a.field_changes,
    })),
  };
}
