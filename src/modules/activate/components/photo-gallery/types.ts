/**
 * Shared types for the Photo Criteria Review Gallery.
 *
 * Single source of truth imported by both the API route
 * (`pages/api/activate/photo-gallery.ts`) and the gallery UI components,
 * so the photo shape can't drift between server and client.
 */

export interface GalleryPhoto {
  drNumber: string;
  filename: string;
  url: string;
  confidence: number;
  originalType: string | null;
}

export interface GalleryStepData {
  step: number;
  count: number;
  photos: GalleryPhoto[];
}

export interface StepCount {
  step: number;
  photo_count: string;
}

export type PhotoDecision = 'good' | 'bad' | null;

export const STEP_LABELS: Record<number, string> = {
  1: 'House Photo',
  2: 'Cable from Pole',
  3: 'Entry Outside',
  4: 'Entry Inside',
  5: 'Wall (ONT Mount)',
  6: 'ONT Back After Install',
  7: 'Power Meter',
  8: 'Final Installation',
  9: 'Green Lights',
  10: 'Signature',
};

/** Stable key for a photo's decision, unique across DRs. */
export const photoKey = (p: GalleryPhoto): string => `${p.drNumber}__${p.filename}`;
