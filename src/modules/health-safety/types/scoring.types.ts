/**
 * H&S Scoring Types
 *
 * Types for H&S score calculations and results.
 */

import type { RAGStatus } from './audit.types';

// Input for contractor H&S score calculation
export interface HSScoreInput {
  contractor_id: number;
  document_compliance: {
    total: number;
    valid: number;
    expired: number;
    pending: number;
  };
  incidents: {
    minor: number;
    moderate: number;
    major: number;
    fatal: number;
  };
  training_records: {
    total: number;
    current: number;
    expired: number;
  };
  corrective_actions: {
    total: number;
    completed: number;
    overdue: number;
    in_progress: number;
  };
  last_audit_score: number | null;
}

// Result from H&S score calculation
export interface HSScoreResult {
  overall_score: number;
  rag_status: RAGStatus;
  breakdown: {
    document_score: number;
    incident_score: number;
    training_score: number;
    corrective_action_score: number;
    audit_score: number;
  };
  issues: string[]; // Critical issues that need attention
  warnings: string[]; // Warnings that should be addressed
  recommendations: string[]; // Improvement suggestions
  gate_approved: boolean;
  gate_blockers: string[];
}

// Project audit score calculation input
export interface AuditScoreInput {
  responses: {
    item_id: string;
    response: 'pass' | 'fail' | 'na' | 'not_checked';
    severity: 'critical' | 'high' | 'medium' | 'low';
    is_mandatory: boolean;
  }[];
}

// Project audit score result
export interface AuditScoreResult {
  overall_score: number;
  rag_status: RAGStatus;
  total_items: number;
  checked_items: number;
  passed_items: number;
  failed_items: number;
  na_items: number;
  critical_failures: number;
  requires_immediate_action: boolean;
  category_breakdown: Record<
    string,
    {
      total: number;
      passed: number;
      failed: number;
      score: number;
    }
  >;
}

// Dashboard statistics
export interface HSDashboardStats {
  // Project H&S
  projects: {
    total_configured: number;
    audits_due: number;
    audits_overdue: number;
    average_score: number;
    by_rag: { red: number; amber: number; green: number };
  };
  // Contractor H&S
  contractors: {
    total: number;
    gate_approved: number;
    gate_blocked: number;
    average_score: number;
    by_rag: { red: number; amber: number; green: number };
  };
  // Incidents (H&S tickets)
  incidents: {
    total_this_month: number;
    total_this_year: number;
    open: number;
    by_severity: {
      minor: number;
      moderate: number;
      major: number;
      fatal: number;
    };
    by_type: {
      injury: number;
      near_miss: number;
      property_damage: number;
      environmental: number;
      other: number;
    };
  };
  // Documents
  documents: {
    expiring_soon: number; // Next 30 days
    expired: number;
    pending_verification: number;
  };
  // Trends
  trends: {
    period: string;
    audits_completed: number;
    average_score: number;
    incidents_reported: number;
  }[];
}

// Scoring configuration
export interface ScoringConfig {
  weights: {
    documents: number;
    incidents: number;
    training: number;
    corrective_actions: number;
    audits: number;
  };
  thresholds: {
    red_max: number;
    amber_max: number;
    gate_minimum: number;
  };
  incident_penalties: {
    minor: number;
    moderate: number;
    major: number;
    fatal: number;
  };
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: {
    documents: 25,
    incidents: 30,
    training: 15,
    corrective_actions: 15,
    audits: 15,
  },
  thresholds: {
    red_max: 49,
    amber_max: 79,
    gate_minimum: 50,
  },
  incident_penalties: {
    minor: 5,
    moderate: 15,
    major: 30,
    fatal: 50,
  },
};
