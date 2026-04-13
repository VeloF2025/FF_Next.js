/**
 * Staff Summary Types - Analytics and summary data structures
 */

export interface StaffSummary {
  totalStaff: number;
  activeStaff: number;
  inactiveStaff: number;
  onLeaveStaff: number;
  availableStaff?: number;
  monthlyGrowth?: number;
  averageProjectLoad?: number;
  staffByDepartment: { [key: string]: number };
  staffByLevel: { [key: string]: number };
  staffBySkill: { [key: string]: number };
  staffByContractType?: { [key: string]: number };
  averageExperience: number;
  utilizationRate: number;
  overallocatedStaff: number;
  underutilizedStaff: number;
  topPerformers?: Record<string, unknown>[];
  topSkills?: Record<string, unknown>[];
}