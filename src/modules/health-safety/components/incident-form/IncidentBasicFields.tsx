/**
 * Incident Basic Fields - Type, severity, date/time classification
 */

import React from 'react';
import {
  INCIDENT_TYPE_CONFIG,
  SEVERITY_CONFIG,
  type HSIncidentType,
  type HSSeverity,
} from '@/modules/health-safety/types/ticket.types';

interface IncidentBasicFieldsProps {
  incidentType: HSIncidentType;
  severity: HSSeverity;
  incidentDate: string;
  incidentTime: string;
  onChange: (field: string, value: string) => void;
}

const inputClass =
  'w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-sm font-medium text-[var(--ff-text-primary)] mb-1';

export function IncidentBasicFields({
  incidentType,
  severity,
  incidentDate,
  incidentTime,
  onChange,
}: IncidentBasicFieldsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider">
        Classification
      </h3>

      {/* Incident Type */}
      <div>
        <label htmlFor="incident_type" className={labelClass}>
          Incident Type *
        </label>
        <select
          id="incident_type"
          value={incidentType}
          onChange={(e) => onChange('incident_type', e.target.value)}
          required
          className={inputClass}
        >
          {Object.entries(INCIDENT_TYPE_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label} — {config.description}
            </option>
          ))}
        </select>
      </div>

      {/* Severity, Date, Time */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="severity" className={labelClass}>
            Severity *
          </label>
          <select
            id="severity"
            value={severity}
            onChange={(e) => onChange('severity', e.target.value)}
            required
            className={inputClass}
          >
            {Object.entries(SEVERITY_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </select>
          {SEVERITY_CONFIG[severity]?.dol_reportable && (
            <p className="mt-1 text-xs text-red-400">
              DoL reportable — must be reported within 24 hours
            </p>
          )}
        </div>
        <div>
          <label htmlFor="incident_date" className={labelClass}>
            Date *
          </label>
          <input
            type="date"
            id="incident_date"
            value={incidentDate}
            onChange={(e) => onChange('incident_date', e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="incident_time" className={labelClass}>
            Time
          </label>
          <input
            type="time"
            id="incident_time"
            value={incidentTime}
            onChange={(e) => onChange('incident_time', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
