/**
 * H&S Checklist Types
 *
 * Types for checklist templates and items used in H&S audits.
 */

export type ChecklistCategory =
  | 'working_at_heights'
  | 'ppe'
  | 'scaffolding'
  | 'electrical'
  | 'first_aid'
  | 'fire'
  | 'fibre_specific'
  | 'site_conditions';

export type ItemSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface HSChecklistTemplate {
  id: string;
  name: string;
  category: ChecklistCategory;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  // Joined data
  items?: HSChecklistItem[];
  item_count?: number;
}

export interface HSChecklistItem {
  id: string;
  template_id: string;
  item_text: string;
  category: ChecklistCategory;
  severity: ItemSeverity;
  regulation_reference: string | null;
  sort_order: number;
  is_mandatory: boolean;
  requires_photo: boolean;
  created_at: string;
}

export interface HSChecklistTemplateInput {
  name: string;
  category: ChecklistCategory;
  description?: string;
  is_default?: boolean;
  is_active?: boolean;
}

export interface HSChecklistItemInput {
  template_id: string;
  item_text: string;
  category: ChecklistCategory;
  severity?: ItemSeverity;
  regulation_reference?: string;
  sort_order?: number;
  is_mandatory?: boolean;
  requires_photo?: boolean;
}

// Category metadata for UI
export interface CategoryInfo {
  value: ChecklistCategory;
  label: string;
  description: string;
  icon: string;
  regulation: string;
}

export const CHECKLIST_CATEGORIES: Record<ChecklistCategory, CategoryInfo> = {
  working_at_heights: {
    value: 'working_at_heights',
    label: 'Working at Heights',
    description: 'Fall protection and height work safety',
    icon: 'ArrowUp',
    regulation: 'Construction Regulations 2014, Reg 8',
  },
  ppe: {
    value: 'ppe',
    label: 'PPE Compliance',
    description: 'Personal protective equipment',
    icon: 'HardHat',
    regulation: 'OHS Act s8(2)(d), General Safety Reg 2',
  },
  scaffolding: {
    value: 'scaffolding',
    label: 'Scaffolding Safety',
    description: 'Scaffolding erection and inspection',
    icon: 'Grid3X3',
    regulation: 'SANS 10085, Construction Reg 16',
  },
  electrical: {
    value: 'electrical',
    label: 'Electrical Safety',
    description: 'Electrical hazards and lock-out/tag-out',
    icon: 'Zap',
    regulation: 'Electrical Installation Regulations',
  },
  first_aid: {
    value: 'first_aid',
    label: 'First Aid Readiness',
    description: 'First aid equipment and personnel',
    icon: 'Cross',
    regulation: 'General Safety Reg 3',
  },
  fire: {
    value: 'fire',
    label: 'Fire Safety',
    description: 'Fire prevention and emergency equipment',
    icon: 'Flame',
    regulation: 'Construction Reg 29',
  },
  fibre_specific: {
    value: 'fibre_specific',
    label: 'Fibre-Specific Safety',
    description: 'Glass fibre, laser, and chemical hazards',
    icon: 'Cable',
    regulation: 'Industry Best Practice',
  },
  site_conditions: {
    value: 'site_conditions',
    label: 'Site Conditions',
    description: 'General site housekeeping and welfare',
    icon: 'Building',
    regulation: 'Construction Reg 24-26',
  },
};

export const SEVERITY_CONFIG: Record<
  ItemSeverity,
  { label: string; color: string; weight: number }
> = {
  critical: { label: 'Critical', color: 'red', weight: 4 },
  high: { label: 'High', color: 'orange', weight: 3 },
  medium: { label: 'Medium', color: 'yellow', weight: 2 },
  low: { label: 'Low', color: 'blue', weight: 1 },
};
