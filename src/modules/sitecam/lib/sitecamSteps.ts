export interface SiteCamStep {
  number: number;
  label: string;
  hasVlm: boolean;
}

export const ACTIVATION_STEPS: readonly SiteCamStep[] = [
  { number: 1,  label: 'House / Property Photo',   hasVlm: true  },
  { number: 2,  label: 'Cable from Pole',           hasVlm: true  },
  { number: 3,  label: 'Entry Outside',             hasVlm: false },
  { number: 4,  label: 'Entry Inside',              hasVlm: false },
  { number: 5,  label: 'Wall (ONT Mount)',          hasVlm: true  },
  { number: 6,  label: 'ONT Back After Install',    hasVlm: false },
  { number: 7,  label: 'Power Meter',               hasVlm: true  },
  { number: 8,  label: 'Final Installation',        hasVlm: true  },
  { number: 9,  label: 'Green Lights on ONT',       hasVlm: true  },
  { number: 10, label: 'Signature',                 hasVlm: true  },
  { number: 11, label: 'Dome Joint Open',           hasVlm: true  },
  { number: 12, label: 'Dome Joint Closed',         hasVlm: true  },
];

export const CIVIL_STEPS: readonly SiteCamStep[] = [
  { number: 1, label: 'Before Photo',  hasVlm: true },
  { number: 2, label: 'During Photo',  hasVlm: true },
  { number: 3, label: 'Depth Photo',   hasVlm: true },
  { number: 4, label: 'End Plates',    hasVlm: true },
  { number: 5, label: 'Compaction / Backfill', hasVlm: true },
  { number: 6, label: 'Level Check',   hasVlm: true },
  { number: 7, label: 'After Photo',   hasVlm: true },
  { number: 8, label: 'Pole Label',    hasVlm: true },
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
