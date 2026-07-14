export interface SiteCamStep {
  number: number;
  label: string;
  hasVlm: boolean;
  hasSerialScan: boolean;
  serialLabel?: string;
  serialDevice?: 'ont' | 'ups';
  /**
   * When true, the capture screen offers a gallery "Upload Photo" button
   * alongside "Take Photo". Reserved for photos legitimately captured outside
   * the SiteCam camera (signature, dome-joint shots); every other step is
   * camera-only to preserve the live-capture / anti-reuse guarantee.
   */
  allowUpload?: boolean;
  /**
   * When true, this step captures a customer sign-off on-screen (printed name +
   * consent + drawn signature) instead of a photo. It is composited into a
   * single image that flows through the normal upload pipeline as this step's
   * photo. Signature steps are not VLM-graded (a drawn signature isn't a photo
   * the model can assess), so they should also set `hasVlm: false`.
   */
  signature?: boolean;
}

export const ACTIVATION_STEPS: readonly SiteCamStep[] = [
  { number: 1,  label: 'House / Property Photo',   hasVlm: true,  hasSerialScan: false },
  { number: 2,  label: 'Cable from Pole',           hasVlm: true,  hasSerialScan: false },
  // Steps 3 & 4 gained VLM criteria in PR #1916 (QUALITY_CHECK_STEPS) but this
  // config was never flipped — photos were auto-accepted with no check at all.
  { number: 3,  label: 'Entry Outside',             hasVlm: true,  hasSerialScan: false },
  { number: 4,  label: 'Entry Inside',              hasVlm: true,  hasSerialScan: false },
  { number: 5,  label: 'Wall (ONT Mount)',          hasVlm: true,  hasSerialScan: false },
  { number: 6,  label: 'ONT Back After Install',    hasVlm: false, hasSerialScan: true,  serialLabel: 'ONT Serial',  serialDevice: 'ont' },
  { number: 7,  label: 'Power Meter',               hasVlm: true,  hasSerialScan: false },
  // Step 8 is VLM-only: the UPS serial is NOT scanned here. Serial scanning
  // happens once, at step 6 (ONT). Final Installation behaves like any photo
  // step — pass advances, fail shows the reason.
  { number: 8,  label: 'Final Installation',        hasVlm: true,  hasSerialScan: false },
  { number: 9,  label: 'Green Lights on ONT',       hasVlm: true,  hasSerialScan: false },
  // Step 10 is the customer sign-off: the customer types their name, ticks the
  // consent box, and signs on-screen. Composited to one image (see
  // SiteCamSignatureStep) — not VLM-graded, not a gallery upload.
  { number: 10, label: 'Signature',                 hasVlm: false, hasSerialScan: false, signature: true },
  { number: 11, label: 'Dome Joint Open',           hasVlm: true,  hasSerialScan: false, allowUpload: true },
  { number: 12, label: 'Dome Joint Closed',         hasVlm: true,  hasSerialScan: false, allowUpload: true },
];

export const CIVIL_STEPS: readonly SiteCamStep[] = [
  { number: 1, label: 'Before Photo',          hasVlm: true, hasSerialScan: false },
  { number: 2, label: 'During Photo',          hasVlm: true, hasSerialScan: false },
  { number: 3, label: 'Depth Photo',           hasVlm: true, hasSerialScan: false },
  { number: 4, label: 'End Plates',            hasVlm: true, hasSerialScan: false },
  { number: 5, label: 'Compaction / Backfill', hasVlm: true, hasSerialScan: false },
  { number: 6, label: 'Level Check',           hasVlm: true, hasSerialScan: false },
  { number: 7, label: 'After Photo',           hasVlm: true, hasSerialScan: false },
  { number: 8, label: 'Pole Label',            hasVlm: true, hasSerialScan: false },
];

export const CIVIL_STEP_LABELS: Record<number, string> = Object.fromEntries(
  CIVIL_STEPS.map((s) => [s.number, s.label])
);

/**
 * The job type as seen by the SiteCam UI/API. The DB gallery column
 * (vlm_visual_photo_examples.job_type) stores 'activation' (singular) for
 * activations — use {@link toGalleryJobType} to map between them rather than
 * re-deriving the singular form inline.
 */
export type SiteCamJobType = 'activations' | 'civils';

/** Job-type vocabulary used by the vlm_visual_photo_examples gallery table. */
export type GalleryJobType = 'activation' | 'civils';

export function toGalleryJobType(jobType: SiteCamJobType): GalleryJobType {
  return jobType === 'civils' ? 'civils' : 'activation';
}

export function getStepsForJobType(jobType: SiteCamJobType): readonly SiteCamStep[] {
  return jobType === 'civils' ? CIVIL_STEPS : ACTIVATION_STEPS;
}
