/**
 * Shared SiteCam types used by both `hooks/useSiteCamCapture.ts` and the
 * `offline/` durability modules. Extracted out of the hook (blind-review fix,
 * PR-3) to break a type-only circular import: the hook imports VALUES from
 * `offline/` (`SiteCamPhotoStore`, `attemptSiteCamSubmit`, ...) while
 * `offline/` modules imported TYPES back from the hook. Type-only circular
 * imports are erased at compile time (no runtime cycle), but the structural
 * smell is worth avoiding — this neutral module is the single source of
 * truth now. `hooks/useSiteCamCapture.ts` re-exports these for existing
 * consumers (components/pages) so their import paths are unaffected.
 */

import type { SiteCamJobType, SerialSpec } from './sitecamSteps';

export type StepStatus =
  | 'pending'
  | 'validating'
  | 'pass'
  | 'fail'
  | 'escalated'
  | 'serial_scan'     // photo passed, waiting for barcode scan
  | 'serial_pending'; // barcode scanned + format valid, saved as pending (cross-ref async)

export interface StepState {
  stepNumber: number;
  label: string;
  hasVlm: boolean;
  hasSerialScan: boolean;
  /**
   * The serials to scan at this step, in order (empty for non-serial steps).
   * Step 6 carries [ONT, Gizzu UPS]; the wizard walks them via `serialIndex`.
   */
  serials: SerialSpec[];
  /** Index into `serials` of the serial currently being scanned (0-based). */
  serialIndex: number;
  /** Label of the CURRENT serial (`serials[serialIndex]`) — mirrored for the UI. */
  serialLabel: string;
  /** Device of the CURRENT serial (`serials[serialIndex]`) — mirrored for the UI. */
  serialDevice: 'ont' | 'ups' | null;
  /** Attempt count for the CURRENT serial (resets when advancing to the next). */
  serialAttempts: number;
  serialScanned: string | null;
  status: StepStatus;
  photoBase64: string | null;
  attemptNumber: number;
  failReasons: string[];
  corrections: string[];
  /**
   * True when the photo auto-passed only because the VLM was unavailable
   * (server or client fail-open). Such photos are uploaded but flagged for
   * manual QA review rather than treated as verified passes.
   */
  needsManualReview: boolean;
}

export interface SiteInfo {
  jobType: SiteCamJobType;
  siteId: string;
  customerName: string | null;
  address: string | null;
  projectName: string | null;
  plannedLat: number | null;
  plannedLon: number | null;
  pon: number | null;
  zone: number | null;
}
