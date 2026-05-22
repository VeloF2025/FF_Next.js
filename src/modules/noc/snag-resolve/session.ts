/**
 * Session-actor helpers + status maps for the public snag/resolve page.
 *
 * Fingerprint is device-scoped (one per browser, shared across share links)
 * so the (token_hash, fingerprint) dedup key on share_session_actors stays
 * stable for a tech working through multiple tickets on one device.
 */

import { TicketStatus } from '@/modules/noc/types/ticket';
import type { SessionActor } from './types';

const ACTOR_STORAGE_KEY = 'ff-resolve-actor';
const FINGERPRINT_STORAGE_KEY = 'ff-resolve-fingerprint';

export function getOrCreateFingerprint(): string {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.localStorage.setItem(FINGERPRINT_STORAGE_KEY, fresh);
  return fresh;
}

export function loadStoredActor(token: string): SessionActor | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`${ACTOR_STORAGE_KEY}:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionActor;
  } catch {
    window.localStorage.removeItem(`${ACTOR_STORAGE_KEY}:${token}`);
    return null;
  }
}

export function persistActor(token: string, actor: SessionActor): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${ACTOR_STORAGE_KEY}:${token}`, JSON.stringify(actor));
}

// Partial so the type-checker tells us when we add a new TicketStatus value
// without giving it a label / colour. Missing keys are handled by the render
// path's `?? FALLBACK` reads.
export const STATUS_LABELS: Partial<Record<TicketStatus, string>> = {
  [TicketStatus.OPEN]: 'Open',
  [TicketStatus.ASSIGNED]: 'Assigned',
  [TicketStatus.IN_PROGRESS]: 'In Progress',
  [TicketStatus.PENDING_QA]: 'Submitted for QA',
  [TicketStatus.RESOLVED]: 'Resolved',
  [TicketStatus.VERIFIED]: 'Verified',
  [TicketStatus.CANCELLED]: 'Cancelled',
};

export const STATUS_COLORS: Partial<Record<TicketStatus, string>> = {
  [TicketStatus.ASSIGNED]: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  [TicketStatus.IN_PROGRESS]: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  [TicketStatus.PENDING_QA]: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  [TicketStatus.RESOLVED]: 'bg-green-500/20 text-green-400 border-green-500/30',
  [TicketStatus.VERIFIED]: 'bg-green-500/20 text-green-400 border-green-500/30',
  [TicketStatus.CANCELLED]: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

/** Fallback colour for any TicketStatus not in STATUS_COLORS (terminal / unknown). */
export const STATUS_COLOR_FALLBACK = 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
