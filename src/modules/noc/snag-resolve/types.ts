/** Shared data + form types for the public /snag/resolve/[token] flow. */

import type { TicketStatus } from '@/modules/noc/types/ticket';

export interface SharedTicket {
  id: string;
  ticket_uid: string;
  status: TicketStatus;
  title: string;
  description: string;
  priority: string;
  assigned_to_name: string | null;
  project_name: string | null;
}

export interface SlotPhoto {
  id: string;
  step_id: string;
  slot_key: string;
  slot_label: string;
  source_mode: 'camera' | 'gallery' | 'either';
  is_required: boolean;
  photo_url: string | null;
  uploaded_by_actor_id: string | null;
  uploaded_at: string | null;
}

export interface VerificationStep {
  id: string;
  step_number: number;
  step_name: string;
  step_description: string;
  is_complete: boolean;
  completed_at: string | null;
  photo_required: boolean;
  photo_url: string | null;
  notes: string | null;
  photo_slots: SlotPhoto[];
}

export interface SharedData {
  ticket: SharedTicket;
  canInteract: boolean;
  canStartWork: boolean;
  canSubmit: boolean;
  steps: VerificationStep[];
  beforePhotos: Array<{ photo_url: string; thumbnail_url: string | null; phase: string }>;
  attachments: Array<{ id: string; filename: string; storage_url: string }>;
}

export interface SessionActor {
  id: string;
  name: string;
  phone: string;
  company: string | null;
}

export interface IdentityFormState {
  name: string;
  phone: string;
  company: string;
}

/** Server-side action values accepted by /api/snags/shared/[token]. */
export type ResolveAction = 'start_work' | 'complete_step' | 'submit_for_qa';

/** Payload queued by the offline-write queue for a 'complete_step' action. */
export interface QueuedCompleteStep {
  token: string;
  stepId: string;
  actorId?: string;
}
