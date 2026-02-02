/**
 * Maintenance Service
 *
 * Handles maintenance scheduling, completion, and calibration tracking.
 */

import { getDbConnection } from '../utils/db';
import { log } from '@/lib/logger';
import {
  ScheduleMaintenanceSchema,
  CompleteMaintenanceSchema,
  type ScheduleMaintenanceInput,
  type CompleteMaintenanceInput,
  type MaintenanceFilterInput,
} from '../utils/schemas';
import type { AssetMaintenance } from '../types/maintenance';

export interface MaintenanceServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface MaintenanceWithAsset extends AssetMaintenance {
  assetName?: string;
  assetNumber?: string;
}

interface MaintenanceDashboardStats {
  totalScheduled: number;
  totalInProgress: number;
  totalCompleted: number;
  totalOverdue: number;
  calibrationsDue30Days: number;
}

/**
 * Transform database row to maintenance object
 */
function transformRow(row: Record<string, unknown>): AssetMaintenance {
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    maintenanceType: row.maintenance_type as AssetMaintenance['maintenanceType'],
    status: row.status as AssetMaintenance['status'],
    scheduledDate: new Date(row.scheduled_date as string),
    dueDate: row.due_date ? new Date(row.due_date as string) : undefined,
    completedDate: row.completed_date ? new Date(row.completed_date as string) : undefined,
    providerName: row.provider_name as string | undefined,
    providerContact: row.provider_contact as string | undefined,
    providerReference: row.provider_reference as string | undefined,
    description: row.description as string | undefined,
    workPerformed: row.work_performed as string | undefined,
    findings: row.findings as string | undefined,
    recommendations: row.recommendations as string | undefined,
    calibrationStandard: row.calibration_standard as string | undefined,
    calibrationCertificateNumber: row.calibration_certificate_number as string | undefined,
    calibrationResults: row.calibration_results as Record<string, unknown> | undefined,
    passFail: row.pass_fail as AssetMaintenance['passFail'],
    nextCalibrationDate: row.next_calibration_date ? new Date(row.next_calibration_date as string) : undefined,
    laborCost: row.labor_cost as number | undefined,
    partsCost: row.parts_cost as number | undefined,
    totalCost: row.total_cost as number | undefined,
    currency: row.currency as string,
    invoiceNumber: row.invoice_number as string | undefined,
    conditionBefore: row.condition_before as AssetMaintenance['conditionBefore'],
    conditionAfter: row.condition_after as AssetMaintenance['conditionAfter'],
    documentIds: row.document_ids as string[],
    notes: row.notes as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    createdBy: row.created_by as string,
    completedBy: row.completed_by as string | undefined,
  };
}

function transformRowWithAsset(row: Record<string, unknown>): MaintenanceWithAsset {
  return {
    ...transformRow(row),
    assetName: row.asset_name as string | undefined,
    assetNumber: row.asset_number as string | undefined,
  };
}

export const maintenanceService = {
  /**
   * Schedule maintenance for an asset
   */
  async schedule(
    input: ScheduleMaintenanceInput,
    createdBy: string
  ): Promise<MaintenanceServiceResult<AssetMaintenance | null>> {
    try {
      // Validate input
      const validation = ScheduleMaintenanceSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          data: null,
          error: validation.error.errors.map(e => e.message).join(', '),
        };
      }

      const sql = getDbConnection();

      // Check if asset exists
      const [asset] = await sql`
        SELECT id FROM assets WHERE id = ${input.assetId}
      `;

      if (!asset) {
        return {
          success: false,
          data: null,
          error: 'Asset not found',
        };
      }

      const [row] = await sql`
        INSERT INTO asset_maintenance (
          asset_id, maintenance_type, scheduled_date, due_date,
          provider_name, provider_contact, description, notes, created_by
        ) VALUES (
          ${input.assetId},
          ${input.maintenanceType},
          ${input.scheduledDate},
          ${input.dueDate || null},
          ${input.providerName || null},
          ${input.providerContact || null},
          ${input.description || null},
          ${input.notes || null},
          ${createdBy}
        )
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Failed to schedule maintenance',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Error scheduling maintenance', { error, input, createdBy }, 'maintenanceService.schedule');
      return {
        success: false,
        data: null,
        error: 'Failed to schedule maintenance',
      };
    }
  },

  /**
   * Complete a maintenance record
   */
  async complete(
    input: CompleteMaintenanceInput,
    completedBy: string
  ): Promise<MaintenanceServiceResult<AssetMaintenance | null>> {
    try {
      // Validate input
      const validation = CompleteMaintenanceSchema.safeParse(input);
      if (!validation.success) {
        return {
          success: false,
          data: null,
          error: validation.error.errors.map(e => e.message).join(', '),
        };
      }

      const sql = getDbConnection();

      // Get maintenance record
      const [maintenance] = await sql`
        SELECT * FROM asset_maintenance WHERE id = ${input.maintenanceId}
      `;

      if (!maintenance) {
        return {
          success: false,
          data: null,
          error: 'Maintenance record not found',
        };
      }

      if (maintenance.status === 'completed') {
        return {
          success: false,
          data: null,
          error: 'Maintenance already completed',
        };
      }

      // Calculate total cost
      const totalCost = (input.laborCost || 0) + (input.partsCost || 0);

      // Update maintenance record
      const [row] = await sql`
        UPDATE asset_maintenance SET
          status = 'completed',
          completed_date = ${input.completedDate},
          work_performed = ${input.workPerformed},
          findings = ${input.findings || null},
          recommendations = ${input.recommendations || null},
          calibration_certificate_number = ${input.calibrationCertificateNumber || null},
          calibration_results = ${input.calibrationResults ? JSON.stringify(input.calibrationResults) : null},
          pass_fail = ${input.passFail || null},
          next_calibration_date = ${input.nextCalibrationDate || null},
          labor_cost = ${input.laborCost || null},
          parts_cost = ${input.partsCost || null},
          total_cost = ${totalCost > 0 ? totalCost : null},
          invoice_number = ${input.invoiceNumber || null},
          condition_after = ${input.conditionAfter},
          notes = COALESCE(${input.notes || null}, notes),
          completed_by = ${completedBy},
          updated_at = NOW()
        WHERE id = ${input.maintenanceId}
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Failed to complete maintenance',
        };
      }

      // If calibration, update asset's calibration dates
      if (maintenance.maintenance_type === 'calibration') {
        await sql`
          UPDATE assets SET
            last_calibration_date = ${input.completedDate},
            next_calibration_date = ${input.nextCalibrationDate || null},
            condition = ${input.conditionAfter},
            updated_at = NOW()
          WHERE id = ${maintenance.asset_id}
        `;
      } else {
        // Update asset condition
        await sql`
          UPDATE assets SET
            last_maintenance_date = ${input.completedDate},
            condition = ${input.conditionAfter},
            updated_at = NOW()
          WHERE id = ${maintenance.asset_id}
        `;
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Error completing maintenance', { error, input, completedBy }, 'maintenanceService.complete');
      return {
        success: false,
        data: null,
        error: 'Failed to complete maintenance',
      };
    }
  },

  /**
   * Cancel a maintenance record
   */
  async cancel(
    id: string,
    reason: string,
    cancelledBy: string
  ): Promise<MaintenanceServiceResult<AssetMaintenance | null>> {
    try {
      const sql = getDbConnection();

      // Get maintenance record
      const [maintenance] = await sql`
        SELECT * FROM asset_maintenance WHERE id = ${id}
      `;

      if (!maintenance) {
        return {
          success: false,
          data: null,
          error: 'Maintenance record not found',
        };
      }

      if (maintenance.status === 'completed') {
        return {
          success: false,
          data: null,
          error: 'Completed maintenance cannot be cancelled',
        };
      }

      const [row] = await sql`
        UPDATE asset_maintenance SET
          status = 'cancelled',
          notes = COALESCE(notes, '') || ' | Cancelled: ' || ${reason},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      if (!row) {
        return {
          success: false,
          data: null,
          error: 'Failed to cancel maintenance',
        };
      }

      return {
        success: true,
        data: transformRow(row),
      };
    } catch (error) {
      log.error('Error cancelling maintenance', { error, id, reason, cancelledBy }, 'maintenanceService.cancel');
      return {
        success: false,
        data: null,
        error: 'Failed to cancel maintenance',
      };
    }
  },

  /**
   * Get maintenance by ID
   */
  async getById(id: string): Promise<MaintenanceServiceResult<AssetMaintenance | null>> {
    try {
      const sql = getDbConnection();

      const [row] = await sql`
        SELECT * FROM asset_maintenance WHERE id = ${id}
      `;

      return {
        success: true,
        data: row ? transformRow(row) : null,
      };
    } catch (error) {
      log.error('Error fetching maintenance', { error, id }, 'maintenanceService.getById');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch maintenance',
      };
    }
  },

  /**
   * Get maintenance records for an asset
   */
  async getByAsset(
    assetId: string,
    filter?: MaintenanceFilterInput
  ): Promise<MaintenanceServiceResult<AssetMaintenance[]>> {
    try {
      const sql = getDbConnection();

      let rows;
      if (filter?.maintenanceType && filter.maintenanceType.length > 0) {
        rows = await sql`
          SELECT * FROM asset_maintenance
          WHERE asset_id = ${assetId}
            AND maintenance_type = ANY(${filter.maintenanceType})
          ORDER BY scheduled_date DESC
        `;
      } else if (filter?.status && filter.status.length > 0) {
        rows = await sql`
          SELECT * FROM asset_maintenance
          WHERE asset_id = ${assetId}
            AND status = ANY(${filter.status})
          ORDER BY scheduled_date DESC
        `;
      } else {
        rows = await sql`
          SELECT * FROM asset_maintenance
          WHERE asset_id = ${assetId}
          ORDER BY scheduled_date DESC
        `;
      }

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Error fetching maintenance by asset', { error, assetId, filter }, 'maintenanceService.getByAsset');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch maintenance records',
      };
    }
  },

  /**
   * Get upcoming maintenance
   */
  async getUpcoming(withinDays: number): Promise<MaintenanceServiceResult<MaintenanceWithAsset[]>> {
    try {
      const sql = getDbConnection();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + withinDays);

      const rows = await sql`
        SELECT m.*, a.name as asset_name, a.asset_number
        FROM asset_maintenance m
        JOIN assets a ON m.asset_id = a.id
        WHERE m.status IN ('scheduled', 'overdue')
          AND m.scheduled_date <= ${dueDate.toISOString().split('T')[0]}
        ORDER BY m.scheduled_date ASC
      `;

      return {
        success: true,
        data: rows.map(transformRowWithAsset),
      };
    } catch (error) {
      log.error('Error fetching upcoming maintenance', { error, withinDays }, 'maintenanceService.getUpcoming');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch upcoming maintenance',
      };
    }
  },

  /**
   * Get overdue maintenance
   */
  async getOverdue(): Promise<MaintenanceServiceResult<MaintenanceWithAsset[]>> {
    try {
      const sql = getDbConnection();

      const rows = await sql`
        SELECT m.*, a.name as asset_name, a.asset_number
        FROM asset_maintenance m
        JOIN assets a ON m.asset_id = a.id
        WHERE m.status = 'overdue'
           OR (m.status = 'scheduled' AND m.due_date < CURRENT_DATE)
        ORDER BY m.due_date ASC
      `;

      return {
        success: true,
        data: rows.map(transformRowWithAsset),
      };
    } catch (error) {
      log.error('Error fetching overdue maintenance', { error }, 'maintenanceService.getOverdue');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch overdue maintenance',
      };
    }
  },

  /**
   * Update overdue status for all maintenance records
   */
  async updateOverdueStatus(): Promise<MaintenanceServiceResult<{ updatedCount: number }>> {
    try {
      const sql = getDbConnection();

      const result = await sql`
        UPDATE asset_maintenance SET
          status = 'overdue',
          updated_at = NOW()
        WHERE status = 'scheduled'
          AND due_date < CURRENT_DATE
        RETURNING id
      `;

      return {
        success: true,
        data: { updatedCount: result.length },
      };
    } catch (error) {
      log.error('Error updating overdue status', { error }, 'maintenanceService.updateOverdueStatus');
      return {
        success: false,
        data: { updatedCount: 0 },
        error: 'Failed to update overdue status',
      };
    }
  },

  /**
   * Get calibration history for an asset
   */
  async getCalibrationHistory(assetId: string): Promise<MaintenanceServiceResult<AssetMaintenance[]>> {
    try {
      const sql = getDbConnection();

      const rows = await sql`
        SELECT * FROM asset_maintenance
        WHERE asset_id = ${assetId}
          AND maintenance_type = 'calibration'
        ORDER BY scheduled_date DESC
      `;

      return {
        success: true,
        data: rows.map(transformRow),
      };
    } catch (error) {
      log.error('Error fetching calibration history', { error, assetId }, 'maintenanceService.getCalibrationHistory');
      return {
        success: false,
        data: [],
        error: 'Failed to fetch calibration history',
      };
    }
  },

  /**
   * Get maintenance dashboard statistics
   */
  async getDashboardStats(): Promise<MaintenanceServiceResult<MaintenanceDashboardStats | null>> {
    try {
      const sql = getDbConnection();

      const [stats] = await sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'scheduled')::int as total_scheduled,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int as total_in_progress,
          COUNT(*) FILTER (WHERE status = 'completed')::int as total_completed,
          COUNT(*) FILTER (WHERE status = 'overdue' OR (status = 'scheduled' AND due_date < CURRENT_DATE))::int as total_overdue,
          COUNT(*) FILTER (WHERE maintenance_type = 'calibration' AND status IN ('scheduled', 'overdue') AND scheduled_date <= CURRENT_DATE + INTERVAL '30 days')::int as calibrations_due_30_days
        FROM asset_maintenance
      `;

      if (!stats) {
        return {
          success: true,
          data: {
            totalScheduled: 0,
            totalInProgress: 0,
            totalCompleted: 0,
            totalOverdue: 0,
            calibrationsDue30Days: 0,
          },
        };
      }

      return {
        success: true,
        data: {
          totalScheduled: stats.total_scheduled || 0,
          totalInProgress: stats.total_in_progress || 0,
          totalCompleted: stats.total_completed || 0,
          totalOverdue: stats.total_overdue || 0,
          calibrationsDue30Days: stats.calibrations_due_30_days || 0,
        },
      };
    } catch (error) {
      log.error('Error fetching maintenance dashboard stats', { error }, 'maintenanceService.getDashboardStats');
      return {
        success: false,
        data: null,
        error: 'Failed to fetch dashboard statistics',
      };
    }
  },
};
