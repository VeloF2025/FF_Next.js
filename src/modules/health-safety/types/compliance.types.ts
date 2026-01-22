/**
 * H&S Contractor Compliance Types
 *
 * Types for contractor H&S compliance tracking, documents, and gate checks.
 */

import type { RAGStatus } from './audit.types';

// Document types that can be uploaded
export type HSDocumentType =
  | 'safety_policy'
  | 'liability_insurance'
  | 'safety_plan'
  | 'training_certs'
  | 'medical_fitness'
  | 'equipment_inspection'
  | 'risk_assessment'
  | 'other';

export type DocumentStatus = 'pending' | 'valid' | 'expired' | 'rejected' | 'expiring_soon';

// Contractor H&S Compliance record
export interface HSContractorCompliance {
  id: string;
  contractor_id: number;
  overall_score: number;
  rag_status: RAGStatus;
  document_score: number;
  incident_score: number;
  training_score: number;
  corrective_action_score: number;
  audit_score: number;
  last_audit_date: string | null;
  next_audit_due: string | null;
  is_gate_approved: boolean;
  gate_blockers: string[];
  gate_warnings: string[];
  calculated_at: string;
  created_at: string;
  updated_at: string;
  // Joined data
  contractor?: {
    id: number;
    company_name: string;
  };
}

// Contractor H&S Document
export interface HSContractorDocument {
  id: string;
  contractor_id: number;
  document_type: HSDocumentType;
  document_name: string;
  file_url: string | null;
  file_size: number | null;
  issue_date: string | null;
  expiry_date: string | null;
  is_verified: boolean;
  verified_by: number | null;
  verified_at: string | null;
  status: DocumentStatus;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  verifier?: { id: number; full_name: string };
}

export interface HSContractorDocumentInput {
  contractor_id: number;
  document_type: HSDocumentType;
  document_name: string;
  file_url?: string;
  file_size?: number;
  issue_date?: string;
  expiry_date?: string;
  notes?: string;
}

// Gate check result
export interface GateCheckResult {
  can_assign: boolean;
  contractor_id: number;
  overall_score: number;
  rag_status: RAGStatus;
  blockers: string[];
  warnings: string[];
  checked_at: string;
  // Score breakdown
  breakdown: {
    document_score: number;
    incident_score: number;
    training_score: number;
    corrective_action_score: number;
    audit_score: number;
  };
  // Document status
  documents: {
    type: HSDocumentType;
    status: DocumentStatus;
    expiry_date: string | null;
    is_required: boolean;
  }[];
}

// Document type configuration
export interface DocumentTypeConfig {
  value: HSDocumentType;
  label: string;
  description: string;
  required_for_gate: boolean;
  typical_validity_months: number;
  icon: string;
}

export const DOCUMENT_TYPES: Record<HSDocumentType, DocumentTypeConfig> = {
  safety_policy: {
    value: 'safety_policy',
    label: 'Safety Policy',
    description: 'Company health and safety policy document',
    required_for_gate: true,
    typical_validity_months: 12,
    icon: 'FileText',
  },
  liability_insurance: {
    value: 'liability_insurance',
    label: 'Liability Insurance',
    description: 'Public liability insurance certificate',
    required_for_gate: true,
    typical_validity_months: 12,
    icon: 'Shield',
  },
  safety_plan: {
    value: 'safety_plan',
    label: 'Safety Plan',
    description: 'Site-specific safety plan',
    required_for_gate: true,
    typical_validity_months: 0, // Project-specific
    icon: 'ClipboardList',
  },
  training_certs: {
    value: 'training_certs',
    label: 'Training Certificates',
    description: 'Staff safety training certificates',
    required_for_gate: false,
    typical_validity_months: 24,
    icon: 'Award',
  },
  medical_fitness: {
    value: 'medical_fitness',
    label: 'Medical Fitness',
    description: 'Medical fitness certificates for height work',
    required_for_gate: false,
    typical_validity_months: 12,
    icon: 'Heart',
  },
  equipment_inspection: {
    value: 'equipment_inspection',
    label: 'Equipment Inspection',
    description: 'Equipment inspection and certification records',
    required_for_gate: false,
    typical_validity_months: 6,
    icon: 'Wrench',
  },
  risk_assessment: {
    value: 'risk_assessment',
    label: 'Risk Assessment',
    description: 'Site-specific risk assessments',
    required_for_gate: false,
    typical_validity_months: 0,
    icon: 'AlertTriangle',
  },
  other: {
    value: 'other',
    label: 'Other',
    description: 'Other H&S related documents',
    required_for_gate: false,
    typical_validity_months: 0,
    icon: 'File',
  },
};

export const REQUIRED_DOCUMENTS: HSDocumentType[] = Object.values(DOCUMENT_TYPES)
  .filter((d) => d.required_for_gate)
  .map((d) => d.value);

export const DOCUMENT_STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; color: string; icon: string }
> = {
  pending: { label: 'Pending Review', color: 'yellow', icon: 'Clock' },
  valid: { label: 'Valid', color: 'green', icon: 'CheckCircle' },
  expired: { label: 'Expired', color: 'red', icon: 'XCircle' },
  rejected: { label: 'Rejected', color: 'red', icon: 'Ban' },
  expiring_soon: { label: 'Expiring Soon', color: 'orange', icon: 'AlertCircle' },
};

// Score weights for compliance calculation
export const COMPLIANCE_WEIGHTS = {
  documents: 25,
  incidents: 30,
  training: 15,
  corrective_actions: 15,
  audits: 15,
} as const;

// Incident penalty points
export const INCIDENT_PENALTIES = {
  minor: 5,
  moderate: 15,
  major: 30,
  fatal: 50,
} as const;

// Compliance summary for dashboard
export interface ComplianceSummary {
  total_contractors: number;
  gate_approved: number;
  gate_blocked: number;
  by_rag: {
    red: number;
    amber: number;
    green: number;
  };
  expiring_documents: number;
  expired_documents: number;
}
