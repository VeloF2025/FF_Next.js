/**
 * Assignment Service
 *
 * Handles asset checkout, checkin, and transfer operations.
 */

import { getDbConnection } from '../utils/db';
import { log } from '@/lib/logger';
import {
  CheckoutAssetSchema,
  CheckinAssetSchema,
  type CheckoutAssetInput,
  type CheckinAssetInput,
} from '../utils/schemas';
import type { AssetAssignment } from '../types/assignment';
import { AssetStatus, type AssetStatusType } from '../constants/assetStatus';
import { AssetCondition } from '../constants/conditions';

export interface AssignmentServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface TransferInput {
  assetId: string;
  fromAssignmentId: string;
  toType: 'staff' | 'project' | 'vehicle' | 'warehouse';
  toId: string;
  toName: string;
  toLocation?: string;
  conditionAtTransfer: string;
}

/**
 * Transform database row to assignment object
 */
function transformRow(row: Record<string, unknown>): AssetAssignment {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    assignmentType: row.assignment_type as AssetAssignment['assignmentType'],
    fromType: row.from_type as AssetAssignment['fromType'],
    fromId: row.from_id as string | undefined,
    fromName: row.from_name as string | undefined,
    fromLocation: row.from_location as string | undefined,
    toType: row.to_type as AssetAssignment['toType'],
    toId: row.to_id as string,
    toName: row.to_name as string,
    toLocation: row.to_location as string | undefined,
    projectId: row.project_id as string | undefined,
    projectName: row.project_name as string | undefined,
    checkedOutAt: new Date(row.checked_out_at as string),
    expectedReturnDate: row.expected_return_date ? new Date(row.expected_return_date as string) : undefined,
    checkedInAt: row.checked_in_at ? new Date(row.checked_in_at as string) : undefined,
    conditionAtCheckout: row.condition_at_checkout as AssetAssignment['conditionAtCheckout'],
    conditionAtCheckin: row.condition_at_checkin as AssetAssignment['conditionAtCheckin'],
    authorizedBy: row.authorized_by as string | undefined,
    authorizationNotes: row.authorization_notes as string | undefined,
    checkedInBy: row.checked_in_by as string | undefined,
    checkinNotes: row.checkin_notes as string | undefined,
    checkoutNotes: row.checkout_notes as string | undefined,
    purpose: row.purpose as string | undefined,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
    createdBy: row.created_by as string,
  };
}

export const assignmentService = {
  /**
   * Checkout an asset
   */
  async checkout(
    input: CheckoutAssetInput,
    createdBy: string
  ): Promise<AssignmentServiceResult<AssetAssignment | null>> {
    try {
      // Validate input
      const validation = CheckoutAssetSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          data: null,
          error: validation.error.errors.map(e => e.message).join(', '),
        };
      }

      const sql = getDbConnection();

      // Check if asset exists and is available
      const [asset] = await sql`
        SELECT id, status, name FROM assets WHERE id = ${input.assetId}
      `;

      if (!asset) {
        return {
          success: false,
          data: null,
          error: 'Asset not found',
        };
      }

      if (asset.status !== AssetStatus.AVAILABLE) {
        return {
          success: false,
          data: null,
          error: `Asset is not available for checkout (current status: ${asset.status})`,
        };
      }

      // Create assignment record
      const [assignment] = await sql`
        INSERT INTO asset_assignments (
          asset_id, assignment_type, to_type, to_id, to_name, to_location,
          project_id, project_name, expected_return_date, condition_at_checkout,
          authorized_by, checkout_notes, purpose, created_by
        ) VALUES (
          ${input.assetId},
          'checkout',
          ${input.toType},
          ${input.toId},
          ${input.toName},
          ${input.toLocation || null},
          ${input.projectId || null},
          ${input.projectName || null},
          ${input.expectedReturnDate || null},
          ${input.conditionAtCheckout},
          ${input.authorizedBy || null},
          ${input.checkoutNotes || null},
          ${input.purpose || null},
          ${createdBy}
        )
        RETURNING *
      `;

      if (!assignment) {
        return {
          success: false,
          data: null,
          error: 'Failed to create assignment',
        };
      }

      // Update asset status and assignment info
      await sql`
        UPDATE assets SET
          status = ${AssetStatus.ASSIGNED},
          current_assignee_type = ${input.toType},
          current_assignee_id = ${input.toId},
          current_assignee_name = ${input.toName},
          assigned_since = NOW(),
          current_location = ${input.toLocation || null},
          updated_at = NOW()
        WHERE id = ${input.assetId}
      `;

      return {
        success: true,
        data: transformRow(assignment),
      };
    } catch (error) {
      log.error('Error checking out asset', { error, input, createdBy }, 'assignmentService.checkout');
      return {
        success: false,
        data: null,
        error: 'Failed to checkout asset',
      };
    }
  },

  /**
   * Checkin an asset
   */
  async checkin(
    input: CheckinAssetInput,
    checkedInBy: string
  ): Promise<AssignmentServiceResult<AssetAssignment | null>> {
    try {
      // Validate input
      const validation = CheckinAssetSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          data: null,
          error: validation.error.errors.map(e => e.message).join(', '),
        };
      }

      const sql = getDbConnection();

      // Get the active assignment
      const [assignment] = await sql`
        SELECT * FROM asset_assignments
        WHERE id = ${input.assignmentId}
      `;

      if (!assignment) {
        return {
          success: false,
          data: null,
          error: 'Assignment not found',
        };
      }

      if (!assignment.is_active) {
        return {
          success: false,
          data: null,
          error: 'Assignment has already been checked in',
        };
      }

      // Update assignment record
      const [updatedAssignment] = await sql`
        UPDATE asset_assignments SET
          is_active = false,
          checked_in_at = NOW(),
          checked_in_by = ${checkedInBy},
          condition_at_checkin = ${input.conditionAtCheckin},
          checkin_notes = ${input.checkinNotes || null}
        WHERE id = ${input.assignmentId}
        RETURNING *
      `;

      if (!updatedAssignment) {
        return {
          success: false,
          data: null,
          error: 'Failed to update assignment',
        };
      }

      // Determine new asset status
      let newStatus: AssetStatusType = AssetStatus.AVAILABLE;
      if (input.maintenanceRequired || input.conditionAtCheckin === AssetCondition.DAMAGED || input.conditionAtCheckin === AssetCondition.NON_FUNCTIONAL) {
        newStatus = AssetStatus.IN_MAINTENANCE;
      }

      // Update asset status
      await sql`
        UPDATE assets SET
          status = ${newStatus},
          condition = ${input.conditionAtCheckin},
          current_assignee_type = NULL,
          current_assignee_id = NULL,
          current_assignee_name = NULL,
          assigned_since = NULL,
          current_location = ${input.newLocation || null},
          updated_at = NOW()
        WHERE id = ${assignment.asset_id}
      `;

      return {
        success: true,
        data: transformRow(updatedAssignment),
      };
    } catch (error) {
      log.error('Error checking in asset', { error, input, checkedInBy }, 'assignmentService.checkin');
      return {
        success: false,
        data: null,
        error: 'Failed to checkin asset',
      };
    }
  },

  /**
   * Transfer an asset between assignees
   */
  async transfer(
    input: TransferInput,
    createdBy: string
  ): Promise<AssignmentServiceResult<AssetAssignment | null>> {
    try {
      const sql = getDbConnection();

      // Get current active assignment
      const [currentAssignment] = await sql`
        SELECT * FROM asset_assignments
        WHERE id = ${input.fromAssignmentId} AND is_active = true
      `;

      if (!currentAssignment) {
        return {
          success: false,
          data: null,
          error: 'Assignment not found or not active',
        };
      }

      // Close current assignment
      await sql`
        UPDATE asset_assignments SET
          is_active = false,
          checked_in_at = NOW()
        WHERE id = ${input.fromAssignmentId}
      `;

      // Create new assignment as transfer
      const [newAssignment] = await sql`
        INSERT INTO asset_assignments (
          asset_id, assignment_type,
          from_type, from_id, from_name, from_location,
          to_type, to_id, to_name, to_location,
          condition_at_checkout, created_by
        ) VALUES (
          ${input.assetId},
          'transfer',
          ${currentAssignment.to_type},
          ${currentAssignment.to_id},
          ${currentAssignment.to_name},
          ${currentAssignment.to_location},
          ${input.toType},
          ${input.toId},
          ${input.toName},
          ${input.toLocation || null},
          ${input.conditionAtTransfer},
          ${createdBy}
        )
        RETURNING *
      `;

      if (!newAssignment) {
        return {
          success: false,
          data: null,
          error: 'Failed to create transfer',
        };
      }

      // Update asset with new assignee
      await sql`
        UPDATE assets SET
          current_assignee_type = ${input.toType},
          current_assignee_id = ${input.toId},
          current_assignee_name = ${input.toName},
          current_location = ${input.toLocation || null},
          assigned_since = NOW(),
          updated_at = NOW()
        WHERE id = ${input.assetId}
      `;

      return {
        success: true,
        data: transformRow(newAssignment),
      };
    } catch (error) {
      log.error('Error transferring asset', { error, input, createdBy }, 'assignmentService.transfer');
      return {
        success: false,
        data: null,
        error: 'Failed to transfer asset',
      };
    }
  },

  /**
   * Get active assignment for an asset
   */
  async getActiveAssignment(
    assetId: string
  ): Promise<AssignmentServiceResult<AssetAssignment | null>> {
    try {
      const sql = getDbConnection();

      const [assignment] = await sql`
        SELECT * FROM asset_assignments
        WHERE asset_id = ${assetId} AND is_active = true
      `;

      return {
        success: true,
        data: assignment ? transformRow(assignment) : null,
      };
    } catch (error) {
      log.error('Error fetching active assignment', { error, assetId }, 'assignmentService.getActiveAssignment');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch active assignment',
      };
    }
  },

  /**
   * Get assignment history for an asset
   */
  async getHistory(assetId: string): Promise<AssignmentServiceResult<AssetAssignment[]>> {
    try {
      const sql = getDbConnection();

      const rows = await sql`
        SELECT * FROM asset_assignments
        WHERE asset_id = ${assetId}
        ORDER BY checked_out_at DESC
      `;

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Error fetching assignment history', { error, assetId }, 'assignmentService.getHistory');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch assignment history',
      };
    }
  },

  /**
   * Get all active assignments for an assignee
   */
  async getByAssignee(
    assigneeType: 'staff' | 'project' | 'vehicle',
    assigneeId: string
  ): Promise<AssignmentServiceResult<AssetAssignment[]>> {
    try {
      const sql = getDbConnection();

      const rows = await sql`
        SELECT * FROM asset_assignments
        WHERE to_type = ${assigneeType}
          AND to_id = ${assigneeId}
          AND is_active = true
        ORDER BY checked_out_at DESC
      `;

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Error fetching assignments by assignee', { error, assigneeType, assigneeId }, 'assignmentService.getByAssignee');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch assignments',
      };
    }
  },

  /**
   * Get overdue returns
   */
  async getOverdueReturns(): Promise<AssignmentServiceResult<AssetAssignment[]>> {
    try {
      const sql = getDbConnection();

      const rows = await sql`
        SELECT * FROM asset_assignments
        WHERE is_active = true
          AND expected_return_date IS NOT NULL
          AND expected_return_date < CURRENT_DATE
        ORDER BY expected_return_date ASC
      `;

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Error fetching overdue returns', { error }, 'assignmentService.getOverdueReturns');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch overdue returns',
      };
    }
  },
};
