/**
 * Snag Import Constants and shared types.
 * Separated from components to satisfy Fast Refresh requirements.
 */

import type { SnagCategory, SnagSeverity } from '../../types/snag.types';

export interface Project {
  id: string;
  name: string;
}

export interface SnagEntry {
  snag_number: number;
  category: SnagCategory;
  severity: SnagSeverity;
  description: string;
  pole_references: string;
}

export const CATEGORY_OPTIONS: { value: SnagCategory; label: string }[] = [
  { value: 'quality',     label: 'Quality' },
  { value: 'safety',      label: 'Safety' },
  { value: 'health',      label: 'Health' },
  { value: 'environment', label: 'Environment' },
  { value: 'traffic',     label: 'Traffic' },
];

export const SEVERITY_OPTIONS: { value: SnagSeverity; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'major',    label: 'Major' },
  { value: 'minor',    label: 'Minor' },
];
