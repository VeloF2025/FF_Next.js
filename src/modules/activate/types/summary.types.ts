/**
 * DR Summary Types
 *
 * Types for the DR Summary page that shows consolidated information
 * about a drop receipt including timeline, team, QA status, and equipment.
 */

export type DRState = 'installed' | 'activated' | 'reviewed' | 'not_reviewed';

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
      name: string | null;
      id: string | null;
    };
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
}

export interface DRSummaryResponse {
  success: boolean;
  data: DRSummary | null;
  error?: string;
}
