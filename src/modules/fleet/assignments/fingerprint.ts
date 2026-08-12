import { createHash } from 'node:crypto';

import type { AssignmentProposalRow } from './types';

export interface AssignmentSourceVersions {
  assignments: string;
  vehicles: string;
  vehicleAssignments: string;
  staff: string;
  projectSites: string;
  teamMembers: string;
  attendancePolicies: string;
}

export function assignmentSourceVersion(versions: AssignmentSourceVersions): string {
  return JSON.stringify({
    assignments: versions.assignments,
    vehicles: versions.vehicles,
    vehicleAssignments: versions.vehicleAssignments,
    staff: versions.staff,
    projectSites: versions.projectSites,
    teamMembers: versions.teamMembers,
    attendancePolicies: versions.attendancePolicies,
  });
}

export function assignmentFingerprint(rows: AssignmentProposalRow[], sourceVersion: string): string {
  const canonicalRows = rows.map((row) => ({
    staffId: row.staffId,
    projectId: row.projectId,
    operationalSiteId: row.operationalSiteId,
    startDate: row.startDate,
    endDate: row.endDate,
    assignmentKind: row.assignmentKind,
    vehicleAssignmentId: row.vehicleAssignmentId,
    reason: row.reason,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash('sha256')
    .update(JSON.stringify({ rows: canonicalRows, sourceVersion }))
    .digest('hex');
}
