/**
 * Project Expiring Documents List (PRD-058)
 * Shows documents expiring within 30 days for a project
 */

import { useState, forwardRef } from 'react';
import { AlertTriangle, Clock, ExternalLink, FileText, ChevronRight, ChevronUp, Loader2 } from 'lucide-react';
import { useProjectExpiringDocs, ExpiringDocument, ExpiryUrgency } from '@/hooks/useProjectOverview';

interface ProjectExpiringDocsListProps {
  projectId: string;
  onNavigateToDocuments?: () => void;
  maxItems?: number;
}

// Get urgency styling
function getUrgencyStyles(urgency: ExpiryUrgency) {
  switch (urgency) {
    case 'expired':
      return {
        bg: 'bg-red-500/10',
        border: 'border-red-500/30',
        text: 'text-red-500',
        badge: 'bg-red-500 text-white',
        label: 'EXPIRED',
      };
    case 'critical':
      return {
        bg: 'bg-red-500/5',
        border: 'border-red-500/20',
        text: 'text-red-500',
        badge: 'bg-red-500/20 text-red-500',
        label: 'Critical',
      };
    case 'warning':
      return {
        bg: 'bg-yellow-500/5',
        border: 'border-yellow-500/20',
        text: 'text-yellow-500',
        badge: 'bg-yellow-500/20 text-yellow-500',
        label: 'Warning',
      };
    case 'upcoming':
      return {
        bg: 'bg-blue-500/5',
        border: 'border-blue-500/20',
        text: 'text-blue-500',
        badge: 'bg-blue-500/20 text-blue-500',
        label: 'Upcoming',
      };
    default:
      return {
        bg: 'bg-[var(--ff-bg-tertiary)]',
        border: 'border-[var(--ff-border-light)]',
        text: 'text-[var(--ff-text-secondary)]',
        badge: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]',
        label: 'Valid',
      };
  }
}

// Format source for display
function formatSource(source: ExpiringDocument['source']): string {
  switch (source) {
    case 'pipeline_approval': return 'Pipeline';
    case 'contractor_document': return 'Contractor';
    case 'agreement': return 'Agreement';
    case 'project_requirement': return 'Requirement';
    case 'staff_document': return 'Staff';
    default: return source;
  }
}

export const ProjectExpiringDocsList = forwardRef<HTMLDivElement, ProjectExpiringDocsListProps>(
  function ProjectExpiringDocsList({
    projectId,
    maxItems = 5,
  }, ref) {
    const { data, isLoading, error } = useProjectExpiringDocs(projectId, 30);
    const [expanded, setExpanded] = useState(false);

    if (isLoading) {
      return (
        <div ref={ref} className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-text-tertiary)]" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Checking documents...</span>
          </div>
        </div>
      );
    }

    if (error || !data) {
      return null;
    }

    const urgentDocs = [
      ...data.by_urgency.expired,
      ...data.by_urgency.critical,
      ...data.by_urgency.warning,
    ];

    if (urgentDocs.length === 0) {
      return (
        <div ref={ref} className="bg-green-500/5 rounded-lg border border-green-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                All Documents Valid
              </p>
              <p className="text-xs text-[var(--ff-text-secondary)]">
                No documents expiring in the next 30 days
              </p>
            </div>
          </div>
        </div>
      );
    }

    const displayDocs = expanded ? urgentDocs : urgentDocs.slice(0, maxItems);
    const remaining = urgentDocs.length - maxItems;

    return (
      <div ref={ref} className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)]">
              Expiring Documents (30 days)
            </h3>
          </div>
          {remaining > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
            >
              {expanded ? 'Show Less' : 'View All'}
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          )}
        </div>

        {/* Document list */}
        <div className="divide-y divide-[var(--ff-border-light)]">
          {displayDocs.map(doc => {
            const styles = getUrgencyStyles(doc.urgency);

            return (
              <div
                key={`${doc.source}-${doc.id}`}
                className={`px-4 py-3 flex items-start gap-3 ${styles.bg}`}
              >
                <div className={`mt-0.5 p-1.5 rounded ${styles.bg}`}>
                  <Clock className={`w-4 h-4 ${styles.text}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                      {doc.document_type}
                    </p>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${styles.badge}`}>
                      {styles.label}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5 truncate">
                    {doc.contractor_name || doc.staff_name || formatSource(doc.source)}
                  </p>

                  <p className={`text-xs mt-1 ${styles.text}`}>
                    {doc.days_until_expiry < 0
                      ? `Expired ${Math.abs(doc.days_until_expiry)} days ago`
                      : doc.days_until_expiry === 0
                      ? 'Expires today'
                      : doc.days_until_expiry === 1
                      ? 'Expires tomorrow'
                      : `Expires in ${doc.days_until_expiry} days`
                    }
                    {' · '}
                    {new Date(doc.expiry_date).toLocaleDateString()}
                  </p>
                </div>

                {doc.document_url && (
                  <a
                    href={doc.document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 p-2 text-[var(--ff-text-tertiary)] hover:text-blue-500 transition-colors"
                    title="View document"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {/* Show more */}
        {!expanded && remaining > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full px-4 py-2 text-xs text-center text-blue-500 hover:text-blue-400 hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            +{remaining} more expiring documents
          </button>
        )}
      </div>
    );
  }
);
