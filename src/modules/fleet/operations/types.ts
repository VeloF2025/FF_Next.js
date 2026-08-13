export type OperationalStatus =
  | 'off_duty' | 'scheduled_not_due' | 'unassigned' | 'unverifiable'
  | 'late' | 'approaching' | 'attendance_confirmed'
  | 'vehicle_on_site_driver_unconfirmed' | 'on_site_dual'
  | 'wrong_site' | 'evidence_mismatch' | 'left_early' | 'shift_complete';

export type OperationalFlag =
  | 'gps_stale' | 'gps_missing' | 'attendance_missing' | 'no_assigned_vehicle'
  | 'assignment_ambiguous' | 'site_geometry_low_confidence' | 'outside_monitoring_window'
  | 'arrival_dwell_pending' | 'wrong_site_confirmation_pending'
  | 'departure_confirmation_pending' | 'vehicle_driver_presence_unconfirmed'
  | 'evidence_source_error';

export interface OperationalRule {
  id: string; version: number; timezone: string; effectiveFrom: string; effectiveTo: string | null;
  monitoringBeforeMinutes: number; monitoringAfterMinutes: number; arrivalDwellMinutes: number;
  wrongSiteConfirmationMinutes: number; earlyDepartureConfirmationMinutes: number;
  approachingDistanceMeters: number; approachingMinReadings: number; minimumMovingSpeedKmh: number;
  evidenceMismatchToleranceMeters: number;
}

export interface OperationalSchedule {
  policyId: string; workDate: string; timezone: string; scheduled: boolean; explicitWork: boolean;
  startTime: string; endTime: string; graceMinutes: number;
}

export interface OperationalPoint { latitude: number; longitude: number; recordedAt: string }

export type OperationalAssignmentSource =
  | 'daily_override' | 'roster' | 'vehicle_project' | 'home_site' | 'unassigned';

export interface OperationalAssignmentEvidence {
  assignmentId: string | null; source: OperationalAssignmentSource; projectId: string | null;
  operationalSiteId: string | null; ambiguous: boolean; siteGeometryValid: boolean;
  siteGeometryLowConfidence: boolean;
}

export interface OperationalSitePointEvidence {
  valid: boolean; inside: boolean; distanceM: number | null; knownSiteId: string | null;
}

export interface OperationalAttendanceEvidence {
  entryId: string | null; clockInAt: string | null; clockOutAt: string | null;
  clockInPoint: OperationalPoint | null; clockOutPoint: OperationalPoint | null;
  matchedSiteId: string | null; requiredSite: OperationalSitePointEvidence | null;
}

export interface OperationalVehiclePoint extends OperationalPoint {
  valid: boolean; inside: boolean; distanceM: number; speedKmh: number; knownSiteId: string | null;
}

export interface OperationalVehicleEvidence {
  assignmentId: string | null; vehicleId: string | null; provider: string | null;
  accountRef: string | null; staleAfterSeconds: number | null; positions: OperationalVehiclePoint[];
}

export interface OperationalEvidence {
  asOf: string; workDate: string; staffId: string; staffName: string;
  assignment: OperationalAssignmentEvidence; schedule: OperationalSchedule | null;
  attendance: OperationalAttendanceEvidence; vehicle: OperationalVehicleEvidence;
  rule: OperationalRule; sourceWarnings: string[]; sourceErrors: string[];
}

export interface OperationalEvaluation {
  status: OperationalStatus; flags: OperationalFlag[]; reasonCodes: string[];
  ruleId: string; ruleVersion: number; sourceTimestamps: string[];
  thresholdsUsed: Record<string, number>;
}

export interface OperationalStatusSummary {
  staffId: string; staffName: string; projectId: string | null; projectName: string | null;
  operationalSiteId: string | null; operationalSiteName: string | null;
  status: OperationalStatus; flags: OperationalFlag[]; reasonCodes: string[];
  scheduledStart: string | null; scheduledEnd: string | null;
  sourceTimestamps: string[]; ruleId: string; ruleVersion: number;
}

export interface OperationalWindow {
  monitoringStart: string; scheduledStart: string; graceEnd: string;
  scheduledEnd: string; monitoringEnd: string;
}

export type OperationalTimePhase =
  | 'off_duty' | 'before_start' | 'grace' | 'active_shift' | 'after_shift';
