'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Plus, Calendar, User, FileText, CheckCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateFormat';
import type { DisciplinaryIncident } from '@/types/staff';
import {
  DISCIPLINARY_TYPE_LABELS,
  DISCIPLINARY_OUTCOME_LABELS,
  DISCIPLINARY_TYPE_COLORS,
  DISCIPLINARY_OUTCOME_COLORS,
  DISCIPLINARY_SEVERITY,
} from '@/types/staff/disciplinary.types';

interface DisciplinaryTabProps {
  staffId: string;
  onAddIncident?: () => void;
  onEditIncident?: (incident: DisciplinaryIncident) => void;
}

export function DisciplinaryTab({ staffId, onAddIncident, onEditIncident }: DisciplinaryTabProps) {
  const [incidents, setIncidents] = useState<DisciplinaryIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/staff/${staffId}/disciplinary`);
        if (!response.ok) throw new Error('Failed to fetch disciplinary records');
        const data = await response.json();
        setIncidents(data.incidents || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load records');
      } finally {
        setLoading(false);
      }
    };

    if (staffId) {
      fetchIncidents();
    }
  }, [staffId]);

  const unresolvedIncidents = incidents.filter((i) => !i.isResolved);
  const resolvedIncidents = incidents.filter((i) => i.isResolved);

  // Sort by severity then date
  const sortedUnresolved = [...unresolvedIncidents].sort((a, b) => {
    const severityDiff = DISCIPLINARY_SEVERITY[b.incidentType] - DISCIPLINARY_SEVERITY[a.incidentType];
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.incidentDate).getTime() - new Date(a.incidentDate).getTime();
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  const getTypeColorClass = (type: string) => {
    const color = DISCIPLINARY_TYPE_COLORS[type as keyof typeof DISCIPLINARY_TYPE_COLORS] || 'gray';
    return `bg-${color}-500/20 text-${color}-400`;
  };

  const getOutcomeColorClass = (outcome: string) => {
    const color = DISCIPLINARY_OUTCOME_COLORS[outcome as keyof typeof DISCIPLINARY_OUTCOME_COLORS] || 'gray';
    return `bg-${color}-500/20 text-${color}-400`;
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      {incidents.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 text-center">
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{incidents.length}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Records</p>
          </div>
          <div className="bg-yellow-500/10 rounded-lg p-4 text-center">
            <p className="text-2xl font-semibold text-yellow-400">{unresolvedIncidents.length}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Active</p>
          </div>
          <div className="bg-green-500/10 rounded-lg p-4 text-center">
            <p className="text-2xl font-semibold text-green-400">{resolvedIncidents.length}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Resolved</p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-4 text-center">
            <p className="text-2xl font-semibold text-red-400">
              {incidents.filter((i) => ['final_warning', 'suspension', 'dismissal'].includes(i.incidentType)).length}
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Serious</p>
          </div>
        </div>
      )}

      {/* Add Button */}
      {onAddIncident && (
        <div className="flex justify-end">
          <button
            onClick={onAddIncident}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Incident
          </button>
        </div>
      )}

      {/* No Records */}
      {incidents.length === 0 && (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-8 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p className="text-lg font-medium text-[var(--ff-text-primary)]">Clean Record</p>
          <p className="text-[var(--ff-text-secondary)]">No disciplinary incidents on file</p>
        </div>
      )}

      {/* Active Incidents */}
      {sortedUnresolved.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            Active Incidents ({sortedUnresolved.length})
          </h2>
          <div className="space-y-3">
            {sortedUnresolved.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                expanded={expandedId === incident.id}
                onToggle={() => setExpandedId(expandedId === incident.id ? null : incident.id)}
                onEdit={onEditIncident}
              />
            ))}
          </div>
        </div>
      )}

      {/* Resolved Incidents */}
      {resolvedIncidents.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            Resolved ({resolvedIncidents.length})
          </h2>
          <div className="space-y-3 opacity-75">
            {resolvedIncidents.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                expanded={expandedId === incident.id}
                onToggle={() => setExpandedId(expandedId === incident.id ? null : incident.id)}
                onEdit={onEditIncident}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface IncidentCardProps {
  incident: DisciplinaryIncident;
  expanded: boolean;
  onToggle: () => void;
  onEdit?: (incident: DisciplinaryIncident) => void;
}

function IncidentCard({ incident, expanded, onToggle, onEdit }: IncidentCardProps) {
  const typeLabel = DISCIPLINARY_TYPE_LABELS[incident.incidentType] || incident.incidentType;
  const outcomeLabel = incident.outcome
    ? DISCIPLINARY_OUTCOME_LABELS[incident.outcome] || incident.outcome
    : 'Pending';

  return (
    <div className={`bg-[var(--ff-bg-tertiary)] rounded-lg border ${
      incident.isResolved ? 'border-transparent' : 'border-yellow-500/30'
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`px-2 py-1 text-xs rounded-full ${
            incident.incidentType === 'verbal_warning' ? 'bg-yellow-500/20 text-yellow-400' :
            incident.incidentType === 'written_warning' ? 'bg-orange-500/20 text-orange-400' :
            incident.incidentType === 'final_warning' ? 'bg-red-500/20 text-red-400' :
            incident.incidentType === 'suspension' ? 'bg-red-500/20 text-red-400' :
            incident.incidentType === 'dismissal' ? 'bg-red-500/20 text-red-400' :
            incident.incidentType === 'counseling' ? 'bg-blue-500/20 text-blue-400' :
            'bg-purple-500/20 text-purple-400'
          }`}>
            {typeLabel}
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {formatDisplayDate(incident.incidentDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 text-xs rounded-full ${
            incident.outcome === 'acknowledged' ? 'bg-green-500/20 text-green-400' :
            incident.outcome === 'disputed' ? 'bg-orange-500/20 text-orange-400' :
            incident.outcome === 'appealed' ? 'bg-yellow-500/20 text-yellow-400' :
            incident.outcome === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {outcomeLabel}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--ff-border-light)]">
          <div className="pt-4 space-y-4">
            {/* Description */}
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Description</p>
              <p className="text-[var(--ff-text-primary)]">{incident.description}</p>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {incident.issuedByStaff && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[var(--ff-text-muted)]" />
                  <div>
                    <p className="text-[var(--ff-text-secondary)]">Issued By</p>
                    <p className="text-[var(--ff-text-primary)]">{incident.issuedByStaff.name}</p>
                  </div>
                </div>
              )}

              {incident.followUpDate && (
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--ff-text-muted)]" />
                  <div>
                    <p className="text-[var(--ff-text-secondary)]">Follow-up Date</p>
                    <p className="text-[var(--ff-text-primary)]">
                      {formatDisplayDate(incident.followUpDate)}
                    </p>
                  </div>
                </div>
              )}

              {incident.resolvedDate && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <div>
                    <p className="text-[var(--ff-text-secondary)]">Resolved</p>
                    <p className="text-[var(--ff-text-primary)]">
                      {formatDisplayDate(incident.resolvedDate)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Follow-up Notes */}
            {incident.followUpNotes && (
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Follow-up Notes</p>
                <p className="text-sm text-[var(--ff-text-primary)]">{incident.followUpNotes}</p>
              </div>
            )}

            {/* Attachments */}
            {incident.attachments && incident.attachments.length > 0 && (
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-2">Attachments</p>
                <div className="flex flex-wrap gap-2">
                  {incident.attachments.map((attachment, i) => (
                    <a
                      key={i}
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-hover)] text-blue-400"
                    >
                      <FileText className="w-4 h-4" />
                      {attachment.filename}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Edit Button */}
            {onEdit && (
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => onEdit(incident)}
                  className="px-3 py-1.5 text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/10"
                >
                  Edit Incident
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
