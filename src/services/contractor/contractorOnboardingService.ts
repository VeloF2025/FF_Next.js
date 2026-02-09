/**
 * Contractor Onboarding Service
 * Manages contractor onboarding workflow stages
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

export interface OnboardingStage {
  id: number;
  contractorId: number | string;
  stageName: string;
  stageOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completionPercentage: number;
  requiredDocuments: string[];
  completedDocuments: string[];
  startedAt?: Date;
  completedAt?: Date;
  dueDate?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingProgress {
  totalStages: number;
  completedStages: number;
  inProgressStages: number;
  pendingStages: number;
  overallProgress: number;
  currentStage?: OnboardingStage;
  isComplete: boolean;
}

export interface UpdateStageRequest {
  status?: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completionPercentage?: number;
  completedDocuments?: string[];
  notes?: string;
}

/**
 * Default contractor onboarding stages template
 * Document types must match DocumentType from contractor-document.types.ts
 */
const DEFAULT_STAGES = [
  {
    stageName: 'Company Registration',
    stageOrder: 1,
    requiredDocuments: ['cipc_registration', 'company_registration', 'tax_clearance'],
  },
  {
    stageName: 'Company Verification',
    stageOrder: 2,
    requiredDocuments: [],
  },
  {
    stageName: 'Financial Documentation',
    stageOrder: 3,
    requiredDocuments: ['bank_confirmation', 'vat_certificate'],
  },
  {
    stageName: 'Insurance & Compliance',
    stageOrder: 4,
    requiredDocuments: ['insurance_liability', 'insurance_workers_comp', 'safety_certificate'],
  },
  {
    stageName: 'Technical Qualifications',
    stageOrder: 5,
    requiredDocuments: ['technical_certification', 'key_staff_credentials'],
  },
  {
    stageName: 'Final Review',
    stageOrder: 6,
    requiredDocuments: [],
  },
];

class ContractorOnboardingService {
  /**
   * Initialize onboarding stages for a new contractor
   */
  async initializeOnboarding(contractorId: number | string): Promise<OnboardingStage[]> {
    const stages: OnboardingStage[] = [];

    for (const template of DEFAULT_STAGES) {
      const [stage] = await sql`
        INSERT INTO contractor_onboarding_stages (
          contractor_id,
          stage_name,
          stage_order,
          status,
          completion_percentage,
          required_documents,
          completed_documents
        ) VALUES (
          ${contractorId},
          ${template.stageName},
          ${template.stageOrder},
          'pending',
          0,
          ${JSON.stringify(template.requiredDocuments)},
          '[]'
        )
        ON CONFLICT (contractor_id, stage_name) DO NOTHING
        RETURNING *
      `;

      if (stage) {
        stages.push(this.mapDbToStage(stage));
      }
    }

    return stages;
  }

  /**
   * Get all onboarding stages for a contractor
   */
  async getOnboardingStages(contractorId: number | string): Promise<OnboardingStage[]> {
    const rows = await sql`
      SELECT * FROM contractor_onboarding_stages
      WHERE contractor_id = ${contractorId}
      ORDER BY stage_order ASC
    `;

    return rows.map(this.mapDbToStage);
  }

  /**
   * Get a specific onboarding stage
   */
  async getStageById(stageId: number): Promise<OnboardingStage | null> {
    const [row] = await sql`
      SELECT * FROM contractor_onboarding_stages
      WHERE id = ${stageId}
    `;

    return row ? this.mapDbToStage(row) : null;
  }

  /**
   * Update an onboarding stage
   */
  async updateStage(
    stageId: number,
    updates: UpdateStageRequest
  ): Promise<OnboardingStage> {
    // Update status and related fields
    if (updates.status !== undefined) {
      if (updates.status === 'in_progress') {
        await sql`
          UPDATE contractor_onboarding_stages
          SET status = ${updates.status}, started_at = NOW(), updated_at = NOW()
          WHERE id = ${stageId}
        `;
      } else if (updates.status === 'completed') {
        await sql`
          UPDATE contractor_onboarding_stages
          SET status = ${updates.status}, completed_at = NOW(), completion_percentage = 100, updated_at = NOW()
          WHERE id = ${stageId}
        `;
      } else {
        await sql`
          UPDATE contractor_onboarding_stages
          SET status = ${updates.status}, updated_at = NOW()
          WHERE id = ${stageId}
        `;
      }
    }

    if (updates.completionPercentage !== undefined) {
      await sql`
        UPDATE contractor_onboarding_stages
        SET completion_percentage = ${updates.completionPercentage}, updated_at = NOW()
        WHERE id = ${stageId}
      `;
    }

    if (updates.completedDocuments !== undefined) {
      await sql`
        UPDATE contractor_onboarding_stages
        SET completed_documents = ${JSON.stringify(updates.completedDocuments)}, updated_at = NOW()
        WHERE id = ${stageId}
      `;
    }

    if (updates.notes !== undefined) {
      await sql`
        UPDATE contractor_onboarding_stages
        SET notes = ${updates.notes}, updated_at = NOW()
        WHERE id = ${stageId}
      `;
    }

    // Fetch and return updated stage
    const [updated] = await sql`
      SELECT * FROM contractor_onboarding_stages
      WHERE id = ${stageId}
    `;

    return this.mapDbToStage(updated);
  }

  /**
   * Get onboarding progress summary
   */
  async getOnboardingProgress(contractorId: number | string): Promise<OnboardingProgress> {
    const stages = await this.getOnboardingStages(contractorId);

    // Initialize stages if none exist
    if (stages.length === 0) {
      const newStages = await this.initializeOnboarding(contractorId);
      return this.calculateProgress(newStages);
    }

    return this.calculateProgress(stages);
  }

  /**
   * Complete contractor onboarding
   */
  async completeOnboarding(contractorId: number | string): Promise<void> {
    // Update contractor record
    await sql`
      UPDATE contractors
      SET
        onboarding_progress = 100,
        onboarding_completed_at = NOW(),
        status = CASE
          WHEN status = 'pending' THEN 'approved'
          ELSE status
        END
      WHERE id = ${contractorId}
    `;

    // Mark all stages as completed
    await sql`
      UPDATE contractor_onboarding_stages
      SET
        status = 'completed',
        completion_percentage = 100,
        completed_at = COALESCE(completed_at, NOW())
      WHERE contractor_id = ${contractorId}
      AND status != 'completed'
    `;
  }

  /**
   * Calculate progress from stages
   */
  private calculateProgress(stages: OnboardingStage[]): OnboardingProgress {
    const totalStages = stages.length;
    const completedStages = stages.filter(s => s.status === 'completed').length;
    const inProgressStages = stages.filter(s => s.status === 'in_progress').length;
    const pendingStages = stages.filter(s => s.status === 'pending').length;

    const overallProgress = totalStages > 0
      ? Math.round((completedStages / totalStages) * 100)
      : 0;

    const currentStage = stages.find(s => s.status === 'in_progress') ||
                        stages.find(s => s.status === 'pending');

    return {
      totalStages,
      completedStages,
      inProgressStages,
      pendingStages,
      overallProgress,
      currentStage,
      isComplete: completedStages === totalStages && totalStages > 0,
    };
  }

  /**
   * Map database row to OnboardingStage
   */
  private mapDbToStage(row: any): OnboardingStage {
    return {
      id: row.id,
      contractorId: row.contractor_id,
      stageName: row.stage_name,
      stageOrder: row.stage_order,
      status: row.status,
      completionPercentage: row.completion_percentage,
      requiredDocuments: row.required_documents || [],
      completedDocuments: row.completed_documents || [],
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      dueDate: row.due_date ? new Date(row.due_date) : undefined,
      notes: row.notes,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const contractorOnboardingService = new ContractorOnboardingService();
