/**
 * H&S Safety Library Types
 *
 * One register for Velocity Fibre's own safety content, discriminated by
 * content_type: chemical safety data sheets (MSDS) alongside safe work
 * procedures, method statements and job safety analyses.
 *
 * `project_id === null` means the entry applies company-wide — the same
 * convention hs_risk_register and hs_appointment_letters already use.
 */

/**
 * Mirrors the hs_safety_library.content_type DB CHECK constraint
 * (migration 464) — kept in sync by safetyLibraryTypeSync.test.ts.
 */
export type SafetyLibraryContentType = 'msds' | 'swp' | 'method_statement' | 'jsa';

/** Derived from review_date — never stored. */
export type LibraryReviewStatus = 'current' | 'review_due_soon' | 'review_overdue' | 'no_review';

/** Days before review_date at which an entry is flagged as due soon. */
export const REVIEW_DUE_SOON_DAYS = 30;

export interface SafetyLibraryTypeConfig {
  value: SafetyLibraryContentType;
  label: string;
  description: string;
  /**
   * true = the chemical-only columns (supplier, GHS hazard class, storage
   * location) apply. Enforced in the DB by
   * hs_safety_library_chemical_fields_msds_only.
   */
  has_chemical_fields: boolean;
}

export const SAFETY_LIBRARY_TYPES: Record<SafetyLibraryContentType, SafetyLibraryTypeConfig> = {
  msds: {
    value: 'msds',
    label: 'Safety Data Sheet (MSDS)',
    description: 'Chemical safety data sheet — hazard class, storage and handling',
    has_chemical_fields: true,
  },
  swp: {
    value: 'swp',
    label: 'Safe Work Procedure',
    description: 'Standing procedure for a recurring task, e.g. Working at Heights',
    has_chemical_fields: false,
  },
  method_statement: {
    value: 'method_statement',
    label: 'Method Statement',
    description: 'Task-specific method statement issued for a scope of work',
    has_chemical_fields: false,
  },
  jsa: {
    value: 'jsa',
    label: 'Job Safety Analysis',
    description: 'Step-by-step hazard breakdown for a specific job',
    has_chemical_fields: false,
  },
};

export interface HSSafetyLibraryEntry {
  id: string;
  content_type: SafetyLibraryContentType;
  title: string;
  reference: string | null;
  version: string | null;
  /** null = applies company-wide */
  project_id: string | null;
  file_url: string | null;
  file_name: string | null;
  effective_date: string | null;
  review_date: string | null;
  notes: string | null;
  is_active: boolean;
  /** MSDS-only — null for every other content type */
  supplier: string | null;
  ghs_hazard_class: string | null;
  storage_location: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A library entry with its derived review status and joined project name. */
export interface HSSafetyLibraryEntryView extends HSSafetyLibraryEntry {
  review_status: LibraryReviewStatus;
  days_to_review: number | null;
  project_name: string | null;
}
