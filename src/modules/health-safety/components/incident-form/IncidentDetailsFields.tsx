/**
 * Incident Details - Title, description, immediate actions, DoL flags
 */

import { SEVERITY_CONFIG, type HSSeverity } from '@/modules/health-safety/types/ticket.types';

interface IncidentDetailsFieldsProps {
  title: string;
  description: string;
  immediateActions: string;
  reportedBy: string;
  isDolReportable: boolean;
  severity: HSSeverity;
  onChange: (field: string, value: string | boolean) => void;
}

const inputClass =
  'w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-sm font-medium text-[var(--ff-text-primary)] mb-1';

export function IncidentDetailsFields({
  title,
  description,
  immediateActions,
  reportedBy,
  isDolReportable,
  severity,
  onChange,
}: IncidentDetailsFieldsProps) {
  const autoDol = SEVERITY_CONFIG[severity]?.dol_reportable ?? false;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider">
        Incident Details
      </h3>

      {/* Title */}
      <div>
        <label htmlFor="title" className={labelClass}>
          Incident Title *
        </label>
        <input
          type="text"
          id="title"
          value={title}
          onChange={(e) => onChange('title', e.target.value)}
          required
          placeholder="Brief description of the incident"
          className={inputClass}
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className={labelClass}>
          Description *
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => onChange('description', e.target.value)}
          required
          rows={4}
          placeholder="What happened? Include injuries, damage, contributing factors..."
          className={`${inputClass} resize-y`}
        />
      </div>

      {/* Immediate Actions */}
      <div>
        <label htmlFor="immediate_actions" className={labelClass}>
          Immediate Actions Taken
        </label>
        <textarea
          id="immediate_actions"
          value={immediateActions}
          onChange={(e) => onChange('immediate_actions', e.target.value)}
          rows={2}
          placeholder="What was done immediately? (e.g., first aid administered, area cordoned off)"
          className={`${inputClass} resize-y`}
        />
      </div>

      {/* Reported By */}
      <div>
        <label htmlFor="reported_by" className={labelClass}>
          Reported By
        </label>
        <input
          type="text"
          id="reported_by"
          value={reportedBy}
          onChange={(e) => onChange('reported_by', e.target.value)}
          placeholder="Name of person reporting"
          className={inputClass}
        />
      </div>

      {/* DoL Reportable */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]">
        <input
          type="checkbox"
          id="dol_reportable"
          checked={isDolReportable || autoDol}
          disabled={autoDol}
          onChange={(e) => onChange('dol_reportable', e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-[var(--ff-border-light)] text-red-500 focus:ring-red-500"
        />
        <label htmlFor="dol_reportable" className="text-sm">
          <span className="font-medium text-[var(--ff-text-primary)]">
            DoL Reportable
          </span>
          <p className="text-[var(--ff-text-tertiary)] mt-0.5">
            {autoDol
              ? `Automatically flagged — ${severity} incidents must be reported to the Department of Labour within 24 hours (OHS Act s24).`
              : 'Check if this incident must be reported to the Department of Labour per OHS Act Section 24.'}
          </p>
        </label>
      </div>
    </div>
  );
}
