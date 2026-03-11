/**
 * Project Activation Service
 * Validates requirements before project can transition from planning → active
 */

import { createLoggedSql } from '@/lib/db-logger';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export interface BlockerStatus {
  met: boolean;
  message: string;
}

export interface WayleaveBlocker extends BlockerStatus {
  expired?: string[];
}

export interface ContractorBlocker extends BlockerStatus {
  signedAgreements?: string[];
}

export interface ClientPOBlocker extends BlockerStatus {
  activePOs?: Array<{
    id: string;
    poNumber: string;
    totalValue: number;
  }>;
}

export interface ActivationBlockers {
  clientPO: ClientPOBlocker;
  wayleaves: WayleaveBlocker;
  hsCompliance: BlockerStatus;
  contractorSigned: ContractorBlocker;
}

export interface ActivationCheck {
  canActivate: boolean;
  blockers: ActivationBlockers;
  summary: {
    total: number;
    met: number;
    pending: number;
  };
}

/**
 * Check if project has at least one active Client Purchase Order
 */
export async function checkClientPO(projectId: string): Promise<ClientPOBlocker> {
  try {
    const activePOs = await sql`
      SELECT id, po_number, total_value
      FROM client_purchase_orders
      WHERE project_id = ${projectId}
      AND status = 'active'
    `;

    if (activePOs.length > 0) {
      return {
        met: true,
        message: `${activePOs.length} active Client PO(s)`,
        activePOs: activePOs.map(po => ({
          id: po.id,
          poNumber: po.po_number,
          totalValue: Number(po.total_value),
        })),
      };
    }

    // Check if there are draft POs
    const draftPOs = await sql`
      SELECT COUNT(*) as count
      FROM client_purchase_orders
      WHERE project_id = ${projectId}
      AND status = 'draft'
    `;

    const draftCount = draftPOs[0] ? Number(draftPOs[0].count) : 0;
    if (draftCount > 0) {
      return {
        met: false,
        message: `No active Client PO (${draftCount} draft PO(s) exist - activate one)`,
      };
    }

    return {
      met: false,
      message: 'No Client PO found - create and activate one',
    };
  } catch (error) {
    log.error('Failed to check client PO', { projectId, error });
    return {
      met: false,
      message: 'Error checking Client PO status',
    };
  }
}

/**
 * Check if all wayleave approvals are valid (not expired)
 */
export async function checkWayleaves(projectId: string): Promise<WayleaveBlocker> {
  try {
    // First check if there's a linked pipeline project
    const pipelineLink = await sql`
      SELECT id FROM pipeline_projects
      WHERE planned_project_id = ${projectId}
    `;

    if (pipelineLink.length > 0 && pipelineLink[0]) {
      // Check pipeline approvals
      const pipelineId = pipelineLink[0].id;
      const expiredApprovals = await sql`
        SELECT pat.name
        FROM pipeline_project_approvals ppa
        JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
        WHERE ppa.pipeline_project_id = ${pipelineId}
        AND pat.category = 'wayleave'
        AND ppa.expiry_date IS NOT NULL
        AND ppa.expiry_date < CURRENT_DATE
      `;

      if (expiredApprovals.length > 0) {
        return {
          met: false,
          message: `Expired wayleave(s) found`,
          expired: expiredApprovals.map(a => a.name),
        };
      }

      return {
        met: true,
        message: 'All wayleave approvals are valid',
      };
    }

    // Check project_requirements for wayleave type
    const wayleaveReqs = await sql`
      SELECT requirement_name, expiry_date
      FROM project_requirements
      WHERE project_id = ${projectId}
      AND requirement_type = 'wayleave'
    `;

    if (wayleaveReqs.length === 0) {
      // No wayleave requirements - considered met
      return {
        met: true,
        message: 'No wayleave requirements configured',
      };
    }

    const expired = wayleaveReqs.filter(
      r => r.expiry_date && new Date(r.expiry_date) < new Date()
    );

    if (expired.length > 0) {
      return {
        met: false,
        message: `Expired wayleave(s) found`,
        expired: expired.map(r => r.requirement_name),
      };
    }

    return {
      met: true,
      message: 'All wayleave requirements are valid',
    };
  } catch (error) {
    log.error('Failed to check wayleaves', { projectId, error });
    return {
      met: false,
      message: 'Error checking wayleave status',
    };
  }
}

/**
 * Check if H&S compliance is verified
 */
export async function checkHSCompliance(projectId: string): Promise<BlockerStatus> {
  try {
    // Check project_requirements for hs_verified
    const hsReq = await sql`
      SELECT is_completed
      FROM project_requirements
      WHERE project_id = ${projectId}
      AND requirement_type = 'hs_verified'
      AND stage = 'planning'
      LIMIT 1
    `;

    if (hsReq.length === 0 || !hsReq[0]) {
      // Requirement doesn't exist - seed it first
      return {
        met: false,
        message: 'H&S requirement not configured - run requirement seeding',
      };
    }

    if (hsReq[0].is_completed) {
      return {
        met: true,
        message: 'H&S verification completed',
      };
    }

    return {
      met: false,
      message: 'H&S verification not completed',
    };
  } catch (error) {
    log.error('Failed to check H&S compliance', { projectId, error });
    return {
      met: false,
      message: 'Error checking H&S status',
    };
  }
}

/**
 * Check if contractor has signed SOW or MBA
 */
export async function checkContractorSigned(projectId: string): Promise<ContractorBlocker> {
  try {
    const signedAgreements = await sql`
      SELECT DISTINCT agreement_type
      FROM contractor_agreements
      WHERE project_id = ${projectId}
      AND status IN ('signed', 'active')
    `;

    if (signedAgreements.length > 0) {
      const types = signedAgreements.map(a => a.agreement_type.toUpperCase());
      return {
        met: true,
        message: `Contractor has signed: ${types.join(', ')}`,
        signedAgreements: types,
      };
    }

    // Check if there are any contractors assigned
    const hasContractor = await sql`
      SELECT COUNT(*) as count
      FROM contractor_agreements
      WHERE project_id = ${projectId}
    `;

    if (Number(hasContractor[0]?.count) === 0) {
      return {
        met: false,
        message: 'No contractor agreement exists - create SOW/MBA',
      };
    }

    return {
      met: false,
      message: 'Contractor has not signed any agreement',
    };
  } catch (error) {
    log.error('Failed to check contractor signed', { projectId, error });
    return {
      met: false,
      message: 'Error checking contractor status',
    };
  }
}

/**
 * Main function: Check all activation requirements
 */
export async function checkActivationRequirements(projectId: string): Promise<ActivationCheck> {
  const [clientPO, wayleaves, hsCompliance, contractorSigned] = await Promise.all([
    checkClientPO(projectId),
    checkWayleaves(projectId),
    checkHSCompliance(projectId),
    checkContractorSigned(projectId),
  ]);

  const blockers: ActivationBlockers = {
    clientPO,
    wayleaves,
    hsCompliance,
    contractorSigned,
  };

  const metCount = [clientPO.met, wayleaves.met, hsCompliance.met, contractorSigned.met]
    .filter(Boolean).length;

  const canActivate = metCount === 4;

  log.info('Activation requirements check', {
    projectId,
    canActivate,
    metCount,
    blockers: {
      clientPO: clientPO.met,
      wayleaves: wayleaves.met,
      hsCompliance: hsCompliance.met,
      contractorSigned: contractorSigned.met,
    },
  });

  return {
    canActivate,
    blockers,
    summary: {
      total: 4,
      met: metCount,
      pending: 4 - metCount,
    },
  };
}

/**
 * Get activation status for UI display
 */
export async function getActivationStatus(projectId: string): Promise<{
  check: ActivationCheck;
  projectStatus: string;
  canTransitionToActive: boolean;
}> {
  const check = await checkActivationRequirements(projectId);

  // Get current project status
  const project = await sql`
    SELECT status FROM projects WHERE id = ${projectId}
  `;

  const projectStatus = project[0]?.status || 'unknown';

  // Can only transition to active from planning status
  const canTransitionToActive = check.canActivate && projectStatus === 'planning';

  return {
    check,
    projectStatus,
    canTransitionToActive,
  };
}
