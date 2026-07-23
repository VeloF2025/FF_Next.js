/**
 * Incident classification + details sections (type, severity, date, location,
 * project/contractor, description, immediate actions)
 */

import { Calendar, FileText } from 'lucide-react';
import { Section, Field } from './DetailPrimitives';
import { INCIDENT_TYPE_CONFIG } from '@/modules/health-safety/types/ticket.types';
import type { IncidentDetail } from './types';

export function IncidentClassificationDetails({ incident }: { incident: IncidentDetail }) {
  const typeConfig = INCIDENT_TYPE_CONFIG[incident.incident_type];

  return (
    <>
      <Section title="Classification" icon={FileText}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Field label="Incident Type" value={typeConfig?.label || incident.incident_type} secondary={typeConfig?.description} />
          <Field label="Severity" value={incident.severity?.toUpperCase()} />
        </div>
      </Section>

      <Section title="Details" icon={Calendar}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-4">
          <Field
            label="Date & Time"
            value={
              incident.incident_date
                ? `${new Date(incident.incident_date).toLocaleDateString()}${incident.incident_time ? ` ${incident.incident_time}` : ''}`
                : '—'
            }
          />
          <Field label="Location" value={incident.location || '—'} />
          <Field label="Project" value={incident.project_name || '—'} />
          <Field label="Contractor" value={incident.contractor_name || '—'} />
        </div>
        {incident.description && (
          <div className="mb-4">
            <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Description</p>
            <p className="text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap">{incident.description}</p>
          </div>
        )}
        {incident.immediate_actions && (
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Immediate Actions</p>
            <p className="text-sm text-[var(--ff-text-primary)] whitespace-pre-wrap">{incident.immediate_actions}</p>
          </div>
        )}
      </Section>
    </>
  );
}
