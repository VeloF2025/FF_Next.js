/**
 * Staff Performance Types - Performance reviews and metrics
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

export interface PerformanceReview {
  id?: string;
  staffId: string;
  reviewerId: string;
  reviewerName: string;
  reviewPeriod: {
    startDate: Timestamp;
    endDate: Timestamp;
  };
  overallRating: number; // 1-5 scale
  technicalSkills: number;
  communication: number;
  reliability: number;
  teamwork: number;
  problemSolving: number;
  comments: string;
  goals: string[];
  improvements: string[];
  achievements: string[];
  reviewDate: Timestamp;
  nextReviewDate: Timestamp;
  status: ReviewStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export enum ReviewStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  COMPLETED = 'completed',
  ACKNOWLEDGED = 'acknowledged',
}