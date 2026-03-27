/**
 * Risk Assessment & Hazard Register Types
 */

export type RiskCategory =
  | 'physical' | 'chemical' | 'biological' | 'ergonomic' | 'environmental'
  | 'electrical' | 'fire' | 'working_at_heights' | 'fibre_specific' | 'vehicle' | 'other';

export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';
export type RiskStatus = 'active' | 'mitigated' | 'closed' | 'accepted';

export interface RiskEntry {
  id: string;
  project_id: string | null;
  hazard_description: string;
  risk_category: RiskCategory;
  site_location: string | null;
  activity_description: string | null;
  persons_at_risk: string | null;
  likelihood: number;
  severity: number;
  risk_score: number;
  risk_level: RiskLevel;
  existing_controls: string | null;
  residual_likelihood: number | null;
  residual_severity: number | null;
  residual_risk_score: number;
  residual_risk_level: RiskLevel;
  additional_controls: string | null;
  responsible_person: string | null;
  responsible_person_name?: string;
  review_date: string | null;
  status: RiskStatus;
  regulation_reference: string | null;
  project_name?: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiskInput {
  project_id?: string;
  hazard_description: string;
  risk_category: RiskCategory;
  site_location?: string;
  activity_description?: string;
  persons_at_risk?: string;
  likelihood: number;
  severity: number;
  existing_controls?: string;
  residual_likelihood?: number;
  residual_severity?: number;
  additional_controls?: string;
  responsible_person?: string;
  review_date?: string;
  regulation_reference?: string;
}

export const RISK_CATEGORIES: Record<RiskCategory, { label: string; icon: string }> = {
  physical: { label: 'Physical', icon: 'Hammer' },
  chemical: { label: 'Chemical', icon: 'FlaskConical' },
  biological: { label: 'Biological', icon: 'Bug' },
  ergonomic: { label: 'Ergonomic', icon: 'Armchair' },
  environmental: { label: 'Environmental', icon: 'TreePine' },
  electrical: { label: 'Electrical', icon: 'Zap' },
  fire: { label: 'Fire', icon: 'Flame' },
  working_at_heights: { label: 'Working at Heights', icon: 'ArrowUp' },
  fibre_specific: { label: 'Fibre-Specific', icon: 'Cable' },
  vehicle: { label: 'Vehicle', icon: 'Truck' },
  other: { label: 'Other', icon: 'AlertTriangle' },
};

export const LIKELIHOOD_SCALE: Record<number, { label: string; description: string }> = {
  1: { label: 'Rare', description: 'May occur only in exceptional circumstances' },
  2: { label: 'Unlikely', description: 'Could occur at some time' },
  3: { label: 'Possible', description: 'Might occur at some time' },
  4: { label: 'Likely', description: 'Will probably occur in most circumstances' },
  5: { label: 'Almost Certain', description: 'Expected to occur in most circumstances' },
};

export const SEVERITY_SCALE: Record<number, { label: string; description: string }> = {
  1: { label: 'Insignificant', description: 'No injuries, low financial loss' },
  2: { label: 'Minor', description: 'First aid, minor property damage' },
  3: { label: 'Moderate', description: 'Medical treatment, moderate damage' },
  4: { label: 'Major', description: 'Serious injury, major damage' },
  5: { label: 'Catastrophic', description: 'Death, permanent disability' },
};

export const RISK_LEVEL_CONFIG: Record<RiskLevel, { label: string; color: string; action: string }> = {
  low: { label: 'Low', color: 'green', action: 'Monitor and review' },
  medium: { label: 'Medium', color: 'yellow', action: 'Implement controls, schedule review' },
  high: { label: 'High', color: 'orange', action: 'Immediate action required' },
  extreme: { label: 'Extreme', color: 'red', action: 'Stop work, implement controls before proceeding' },
};
