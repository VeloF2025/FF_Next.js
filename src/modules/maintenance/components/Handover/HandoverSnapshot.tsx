/**
 * HandoverSnapshot Component - Display immutable handover snapshot
 *
 * 🟢 WORKING: Production-ready snapshot display component
 *
 * Features:
 * - Display snapshot data (ticket state at handover)
 * - Show evidence links (photos, documents)
 * - Display decisions (approvals, risk acceptances)
 * - Ownership transfer information
 * - Locked status indicator
 * - Formatted timestamps
 * - Expandable sections
 */

'use client';

import React, { useState } from 'react';
import {
  Lock,
  FileText,
  Image,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Calendar,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HandoverSnapshot } from '../../types/handover';

interface HandoverSnapshotProps {
  /** Handover snapshot to display */
  snapshot: HandoverSnapshot;
  /** Compact mode for smaller display */
  compact?: boolean;
  /** Show all sections expanded by default */
  expandedByDefault?: boolean;
  /** Show evidence links section */
  showEvidence?: boolean;
  /** Show decisions section */
  showDecisions?: boolean;
}

/**
 * 🟢 WORKING: Format handover type for display
 */
function formatHandoverType(type: string): string {
  const typeMap: Record<string, string> = {
    build_to_qa: 'Build → QA',
    qa_to_maintenance: 'QA → Maintenance',
    maintenance_complete: 'Maintenance Complete',
  };
  return typeMap[type] || type;
}

/**
 * 🟢 WORKING: Format owner type for display
 */
function formatOwnerType(type: string | null): string {
  if (!type) return 'Unknown';
  const typeMap: Record<string, string> = {
    build: 'Build Team',
    qa: 'QA Team',
    maintenance: 'Maintenance Team',
  };
  return typeMap[type] || type;
}

/**
 * 🟢 WORKING: Collapsible section component
 */
function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultExpanded = false,
  count,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  count?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          <span className="font-medium text-[var(--ff-text-primary)]">{title}</span>
          {count !== undefined && (
            <span className="px-2 py-0.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded text-xs font-medium">
              {count}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        ) : (
          <ChevronDown className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        )}
      </button>

      {isExpanded && <div className="p-4">{children}</div>}
    </div>
  );
}

/**
 * 🟢 WORKING: Main snapshot display component
 */
export function HandoverSnapshot({
  snapshot,
  compact = false,
  expandedByDefault = false,
  showEvidence = false,
  showDecisions = false,
}: HandoverSnapshotProps) {
  const snapshotData = typeof snapshot.snapshot_data === 'string'
    ? JSON.parse(snapshot.snapshot_data)
    : snapshot.snapshot_data;
  const evidenceLinks = snapshot.evidence_links
    ? (typeof snapshot.evidence_links === 'string' ? JSON.parse(snapshot.evidence_links) : snapshot.evidence_links)
    : [];
  const decisions = snapshot.decisions
    ? (typeof snapshot.decisions === 'string' ? JSON.parse(snapshot.decisions) : snapshot.decisions)
    : [];

  return (
    <div className="space-y-4">
      {/* Header - Handover Info */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-[var(--ff-text-primary)] mb-2">
              {formatHandoverType(snapshot.handover_type)}
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Ticket: <span className="font-mono text-[var(--ff-text-primary)]">{snapshotData.ticket_uid}</span>
            </p>
          </div>

          {/* Locked Indicator - Snapshots are always locked (immutable) */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-full text-sm font-medium">
            <Lock className="w-4 h-4" />
            <span>Locked</span>
          </div>
        </div>

        {/* Ownership Transfer */}
        {(snapshot.from_owner_type || snapshot.to_owner_type) && (
          <div className="flex items-center gap-4 p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
            <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm font-medium">
              {formatOwnerType(snapshot.from_owner_type)}
            </span>
            <ArrowRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm font-medium">
              {formatOwnerType(snapshot.to_owner_type)}
            </span>
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4 border-t border-[var(--ff-border-light)]">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <span className="text-[var(--ff-text-secondary)]">Handover At:</span>
            <span className="text-[var(--ff-text-primary)]">
              {new Date(snapshot.handover_at).toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <User className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <span className="text-[var(--ff-text-secondary)]">Handover By:</span>
            <span className="text-[var(--ff-text-primary)] font-mono">{snapshot.handover_by.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {/* Ticket Snapshot Data */}
      <CollapsibleSection
        title="Ticket Snapshot Data"
        icon={FileText}
        defaultExpanded={expandedByDefault}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Basic Info */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">Basic Information</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Title:</span>
                <span className="text-[var(--ff-text-primary)] text-right">{snapshotData.title}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Status:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.status}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Priority:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.priority}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Type:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.ticket_type}</span>
              </div>
            </div>
          </div>

          {/* Location Data */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">Location</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">DR Number:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.dr_number || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Pole:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.pole_number || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">PON:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.pon_number || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Zone:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.zone_id || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Equipment Data */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">Equipment</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">ONT Serial:</span>
                <span className="text-[var(--ff-text-primary)] font-mono">{snapshotData.ont_serial || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">ONT RX Level:</span>
                <span className="text-[var(--ff-text-primary)]">
                  {snapshotData.ont_rx_level !== null ? `${snapshotData.ont_rx_level} dBm` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">ONT Model:</span>
                <span className="text-[var(--ff-text-primary)]">{snapshotData.ont_model || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Verification Progress */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">Progress</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Verification:</span>
                <span className="text-[var(--ff-text-primary)]">
                  {snapshotData.verification_steps_completed} / {snapshotData.verification_steps_total}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">QA Ready:</span>
                <span className={cn(
                  "font-medium",
                  snapshotData.qa_ready ? "text-green-400" : "text-red-400"
                )}>
                  {snapshotData.qa_ready ? 'Yes' : 'No'}
                </span>
              </div>
              {snapshotData.fault_cause && (
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--ff-text-secondary)]">Fault Cause:</span>
                  <span className="text-[var(--ff-text-primary)]">{snapshotData.fault_cause}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Evidence Links */}
      {showEvidence && (
        evidenceLinks.length > 0 ? (
          <CollapsibleSection
            title="Evidence"
            icon={Image}
            count={evidenceLinks.length}
            defaultExpanded={expandedByDefault}
          >
            <div className="space-y-2">
              {evidenceLinks.map((evidence: any, index: number) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {evidence.type === 'photo' ? (
                      <Image className="w-4 h-4 text-blue-400" />
                    ) : (
                      <FileText className="w-4 h-4 text-green-400" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-[var(--ff-text-primary)]">{evidence.filename}</p>
                      <p className="text-xs text-[var(--ff-text-secondary)]">
                        Uploaded {new Date(evidence.uploaded_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {evidence.url && (
                    <a
                      href={evidence.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        ) : (
          <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-center">
            <p className="text-sm text-[var(--ff-text-secondary)]">No evidence attached</p>
          </div>
        )
      )}

      {/* Decisions */}
      {showDecisions && (
        decisions.length > 0 ? (
          <CollapsibleSection
            title="Decisions"
            icon={CheckCircle2}
            count={decisions.length}
            defaultExpanded={expandedByDefault}
          >
            <div className="space-y-3">
              {decisions.map((decision: any, index: number) => (
                <div
                  key={index}
                  className={cn(
                    "p-3 rounded-lg border",
                    decision.decision_type === 'risk_acceptance'
                      ? "bg-yellow-500/10 border-yellow-500/20"
                      : decision.decision_type === 'approval'
                      ? "bg-green-500/10 border-green-500/20"
                      : "bg-blue-500/10 border-blue-500/20"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-1 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded text-xs font-medium uppercase">
                      {decision.decision_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-[var(--ff-text-secondary)]">
                      {new Date(decision.decision_at).toLocaleString()}
                    </span>
                  </div>
                  {decision.notes && (
                    <p className="text-sm text-[var(--ff-text-primary)]">{decision.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        ) : (
          <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-center">
            <p className="text-sm text-[var(--ff-text-secondary)]">No decisions recorded</p>
          </div>
        )
      )}

      {/* Guarantee Status */}
      {snapshot.guarantee_status && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-[var(--ff-text-secondary)]">Guarantee Status:</span>
            <span className={cn(
              "px-3 py-1 rounded-full text-sm font-medium",
              snapshot.guarantee_status === 'under_guarantee'
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            )}>
              {snapshot.guarantee_status.replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
