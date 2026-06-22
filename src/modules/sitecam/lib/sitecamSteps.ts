export interface SiteCamStep {
  number: number;
  label: string;
  hasVlm: boolean;
  hasSerialScan: boolean;
  serialLabel?: string;
  serialDevice?: 'ont' | 'ups';
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
  { number: 10, label: 'Signature',                 hasVlm: true,  hasSerialScan: false },
  { number: 11, label: 'Dome Joint Open',           hasVlm: true,  hasSerialScan: false },
  { number: 12, label: 'Dome Joint Closed',         hasVlm: true,  hasSerialScan: false },
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
