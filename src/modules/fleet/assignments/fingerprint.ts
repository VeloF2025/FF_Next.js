import { createHash } from 'node:crypto';

import type { AssignmentProposalRow } from './types';

export interface AssignmentSourceVersions {
  assignments: string;
  vehicleAssignments: string;
  staff: string;
  projectSites: string;
  teamMembers: string;
  attendancePolicies: string;
}

export function assignmentSourceVersion(versions: AssignmentSourceVersions): string {
  return JSON.stringify({
    assignments: versions.assignments,
    vehicleAssignments: versions.vehicleAssignments,
    staff: versions.staff,
    projectSites: versions.projectSites,
    teamMembers: versions.teamMembers,
    attendancePolicies: versions.attendancePolicies,
  });
}

export function assignmentFingerprint(rows: AssignmentProposalRow[], sourceVersion: string): string {
  const canonicalRows = [...rows].sort((left, right) => (
    left.staffId.localeCompare(right.staffId)
    || left.projectId.localeCompare(right.projectId)
    || left.operationalSiteId.localeCompare(right.operationalSiteId)
    || left.startDate.localeCompare(right.startDate)
    || left.endDate.localeCompare(right.endDate)
  ));
  return createHash('sha256')
    .update(JSON.stringify({ rows: canonicalRows, sourceVersion }))
    .digest('hex');
}
