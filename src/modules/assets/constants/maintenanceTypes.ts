/**
 * Maintenance Type Constants
 *
 * Defines the types of maintenance and their statuses.
 */

export const MaintenanceType = {
  CALIBRATION: 'calibration',
  PREVENTIVE: 'preventive',
  CORRECTIVE: 'corrective',
  INSPECTION: 'inspection',
  CERTIFICATION: 'certification',
} as const;

export type MaintenanceTypeValue = (typeof MaintenanceType)[keyof typeof MaintenanceType];

export const MaintenanceStatus = {
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
} as const;

export type MaintenanceStatusValue = (typeof MaintenanceStatus)[keyof typeof MaintenanceStatus];

export const MAINTENANCE_TYPE_CONFIG: Record<
  MaintenanceTypeValue,
  { label: string; description: string; icon: string }
> = {
  [MaintenanceType.CALIBRATION]: {
    label: 'Calibration',
    description: 'Required for test equipment accuracy',
    icon: 'gauge',
  },
  [MaintenanceType.PREVENTIVE]: {
    label: 'Preventive',
    description: 'Scheduled preventive maintenance',
    icon: 'shield-check',
  },
  [MaintenanceType.CORRECTIVE]: {
    label: 'Corrective',
    description: 'Repair after failure or damage',
    icon: 'wrench',
  },
  [MaintenanceType.INSPECTION]: {
    label: 'Inspection',
    description: 'Regular inspection check',
    icon: 'eye',
  },
  [MaintenanceType.CERTIFICATION]: {
    label: 'Certification',
    description: 'Re-certification requirement',
    icon: 'award',
  },
};

export const MAINTENANCE_STATUS_CONFIG: Record<
  MaintenanceStatusValue,
  { label: string; color: string }
> = {
  [MaintenanceStatus.SCHEDULED]: {
    label: 'Scheduled',
    color: 'blue',
  },
  [MaintenanceStatus.IN_PROGRESS]: {
    label: 'In Progress',
    color: 'yellow',
  },
  [MaintenanceStatus.COMPLETED]: {
    label: 'Completed',
    color: 'green',
  },
  [MaintenanceStatus.OVERDUE]: {
    label: 'Overdue',
    color: 'red',
  },
  [MaintenanceStatus.CANCELLED]: {
    label: 'Cancelled',
    color: 'gray',
  },
};

/**
 * Assignment Target Types - who/what can assets be assigned to
 */
export const AssignmentTargetType = {
  STAFF: 'staff',
  PROJECT: 'project',
  VEHICLE: 'vehicle',
  CONTRACTOR: 'contractor',
  WAREHOUSE: 'warehouse',
} as const;

export type AssignmentTargetTypeValue =
  (typeof AssignmentTargetType)[keyof typeof AssignmentTargetType];

export const ASSIGNMENT_TARGET_CONFIG: Record<
  AssignmentTargetTypeValue,
  { label: string; icon: string }
> = {
  [AssignmentTargetType.STAFF]: {
    label: 'Staff Member',
    icon: 'user',
  },
  [AssignmentTargetType.PROJECT]: {
    label: 'Project',
    icon: 'folder',
  },
  [AssignmentTargetType.VEHICLE]: {
    label: 'Vehicle',
    icon: 'truck',
  },
  [AssignmentTargetType.CONTRACTOR]: {
    label: 'Contractor / SMME',
    icon: 'hard-hat',
  },
  [AssignmentTargetType.WAREHOUSE]: {
    label: 'Warehouse',
    icon: 'warehouse',
  },
};
