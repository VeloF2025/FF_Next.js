/**
 * DR Summary Types
 *
 * Types for the DR Summary page that shows consolidated information
 * about a drop receipt including timeline, team, QA status, and equipment.
 */

export type DRState = 'installed' | 'activated' | 'reviewed' | 'reviewed_pass' | 'reviewed_fail' | 'reviewed_rework' | 'not_reviewed';

export type QADecision = 'PASS' | 'FAIL' | 'REWORK_NEEDED' | null;

export interface DRSummary {
  dropNumber: string;
  project: string | null;
  currentState: DRState;

  timeline: {
    installationDate: string | null; // from drops table
    submittedAt: string | null; // from dr_photo_unified_reviews
    reviewedAt: string | null; // from dr_photo_unified_reviews
    feedbackSentAt: string | null; // from dr_photo_unified_reviews
    activationDate: string | null; // from oes_activations
  };

  team: {
    submitter: {
      name: string | null;
      phone: string | null;
    };
    installer: {
      name: string | null; // from 1Map fieldnme3 via BOSS API
      id: string | null;
    };
    signupAgent: string | null; // from 1Map fieldnme2 via BOSS API
    oesTeam: string | null;
    reviewer: string | null;
  };

  qaStatus: {
    stepsComplete: number; // 0-10
    totalSteps: number; // Always 10
    feedbackSent: boolean;
    feedbackMessage: string | null;
    decision: QADecision;
  };

  equipment: {
    ontSerial: string | null;
    upsSerial: string | null;
  };

  photoPreview: Array<{
    url: string;
    step: number;
    filename: string;
  }>;

  // Resubmission tracking (Jan 2026)
  submission_count: number;
  is_resubmission: boolean;
  previous_photo_count: number | null;
  feedback_message: string | null;
}

export interface DRSummaryResponse {
  success: boolean;
  data: DRSummary | null;
  error?: string;
}
