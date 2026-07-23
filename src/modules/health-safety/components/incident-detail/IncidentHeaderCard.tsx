/**
 * Incident header card - title, ticket UID, severity/status/DoL badges
 */

import { ShieldAlert } from 'lucide-react';
import { severityColors, statusColors, type IncidentDetail } from './types';

export function IncidentHeaderCard({ incident }: { incident: IncidentDetail }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
          {incident.title || 'Untitled Incident'}
        </h1>
        <span className="px-2 py-0.5 text-xs font-mono rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
          {incident.ticket_uid}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${severityColors[incident.severity] || severityColors.minor}`}>
          {incident.severity?.toUpperCase() || 'UNKNOWN'}
        </span>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[incident.status] || statusColors.open}`}>
          {incident.status?.toUpperCase() || 'OPEN'}
        </span>
        {incident.dol_reportable && (
          <span
            className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded ${
              incident.dol_reported
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            DoL {incident.dol_reported ? 'Reported' : 'Reportable'}
          </span>
        )}
      </div>
    </div>
  );
}
