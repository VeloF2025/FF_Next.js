/**
 * PWA-specific types for the field-stock issue/return flow on /my/stores.
 *
 * These are client-side shapes, intentionally separate from the server-side
 * procurement module types so the PWA layer has no server imports.
 */

// 🟢 WORKING: Verbatim from plan 2026-05-19-field-stock-pwa.md § Task 2.1

export interface PwaTechSummary {
  id: string;
  name: string;
  phone: string | null;
  contractorId: string | null;
  contractorName: string | null;
  accountStatus: 'pending' | 'active' | 'suspended';
  /** Staff role — 'casual' workers receive stock exactly like technicians. */
  role: string | null;
  /** The person's site: admin assignment if set, otherwise their own declaration. */
  siteProjectId: string | null;
  siteProjectName: string | null;
  /** Where siteProjectId came from, so the UI can say so rather than imply certainty. */
  siteSource: 'assigned' | 'declared' | 'none';
  /** How that site relates to the store being issued from. */
  siteMatch: 'match' | 'elsewhere' | 'unknown-staff' | 'unmapped-store';
}

export interface PwaScannedSerial {
  serialNumber: string;
  stockItemId: string;
  stockItemName: string;
  scannedAt: number; // epoch ms; used for sort + audit
  state: 'pending-validation' | 'valid' | 'invalid';
  errorMessage?: string;
  /**
   * Set on a VALID row that is worth flagging — today, a serial recorded at a
   * different warehouse than the one it is being issued from. Usable, recorded,
   * not blocked.
   */
  warning?: string;
  /**
   * How this serial reached us: 'machine' from a printed barcode (carton
   * DataMatrix, photo decode, live camera), 'manual' when typed by hand.
   * Only a machine read may take stock in that the sheet has never listed.
   */
  scanSource?: 'machine' | 'manual';
  /** Carton package id, when the serial came from a box scan. */
  cartonId?: string;
  /** Set on every member of one carton scan; absent for individually scanned units. */
  groupId?: string;
  /** Human label for the group header, e.g. 'Box · 9 serials'. Set on every member. */
  groupLabel?: string;
}

export interface PwaIssueDraft {
  technicianId: string;
  contractorId: string | null;
  stockItemId: string;
  serials: PwaScannedSerial[];
  /** Quantity for non-serial (lot/quantity/none) items. Undefined for serial issues. */
  quantity?: number;
  /** FK to projects.id — the project this stock is issued against. Optional:
   *  legacy/ad-hoc issues may have no project (rolls up as "Unassigned" in the
   *  Accountability per-project breakdown). */
  projectId?: string | null;
  /** VF Storage key of the mandatory proof photo (non-serial issues only). */
  proofPhotoKey?: string;
  /** Public /storage/... URL of the proof photo (non-serial issues only). */
  proofPhotoUrl?: string;
  signatureDataUrl: string | null;
  notes: string;
  /** FK to stock_locations.id — the warehouse the stock is issued FROM. */
  sourceLocationId: string;
  /** FK to stock_locations.id — fixed FIELD-DEFAULT UUID (migration 357). */
  destinationLocationId: string;
}

export interface PwaPickingResult {
  pickingId: string;
  pickingNumber: string; // ISS-YYYYMM-#####
  status: 'pending' | 'confirmed' | 'processed' | 'signed';
}

// =============================================================================
// Phase 3 — Return flow
// =============================================================================

import type { ReturnReason } from './lib/returnReasons';
import type { ReturnCondition } from './lib/conditionOptions';
import type { ReturnDisposition } from './lib/dispositionOptions';

/**
 * A serial currently held by the calling tech, returned by GET /my-serials.
 * Only serials with status='issued' are returned; installed/returned/scrapped are filtered out.
 * (status='issued' is the correct value per Task A.1 schema probe — NOT 'assigned'.)
 *
 * The holding relationship is derived via the picking chain — there is no direct
 * assigned_to_staff_id column on stock_serials.
 */
export interface PwaMyHeldSerial {
  serialId: string;             // stock_serials.id (UUID)
  serialNumber: string;         // stock_serials.serial_number (string)
  stockItemId: string;          // stock_items.id
  stockItemName: string;        // stock_items.name
  /** Source warehouse derived from the latest issue picking. */
  sourceLocationId: string;
  sourceLocationName: string;
}

export interface PwaReturnDraft {
  /** One reason for the whole batch — written as return_reason on every line. */
  reason: ReturnReason;
  /** Optional free-text reason note (kept for future "other" support). */
  reasonNotes: string | null;
  serials: PwaMyHeldSerial[];
  signatureDataUrl: string | null;
  /** Derived from first scanned serial; also passed to API for server validation. */
  returnToLocationId: string;
  /** Originating issue picking — best-effort; only populated when all serials trace
   *  back to the same picking. Leave null when they don't. */
  originalPickingId: string | null;
  /** Free-text note from the tech (separate from per-line notes at inspect). */
  notes: string;
}

export interface PwaReturnResult {
  returnId: string;
  returnNumber: string;          // RET-YYYYMM-NNNNN
  status: 'pending' | 'inspected' | 'restocked';
}

export interface PwaLineDisposition {
  /** stock_return_lines.id (UUID) returned by the list call. */
  lineId: string;
  condition: ReturnCondition;
  disposition: ReturnDisposition;
  notes: string | null;
}

export interface PwaInspectAcceptDraft {
  returnId: string;
  inspectionNotes: string;
  lineDispositions: PwaLineDisposition[];
  signatureDataUrl: string | null;
}
