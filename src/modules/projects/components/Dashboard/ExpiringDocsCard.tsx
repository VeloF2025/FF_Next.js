/**
 * Expiring Documents Card (PRD-058)
 * Displays document expiry alerts by timeframe with unified data
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, XCircle, Clock, Calendar, FolderKanban, Building2, FileCheck, User } from 'lucide-react';
import type { ExpiringDocsMetrics } from './types';

type DocumentSource = 'pipeline_approval' | 'contractor_document' | 'agreement' | 'project_requirement' | 'staff_document';
type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'upcoming';

interface ExpiringDocument {
  id: string;
  source: DocumentSource;
  document_type: string;
  document_name: string;
  days_until_expiry: number;
  urgency: ExpiryUrgency;
  project_id?: string;
  project_name?: string;
  contractor_id?: string;
  contractor_name?: string;
  staff_id?: string;
  staff_name?: string;
}

interface ExpiringDocsCardProps {
  expiringDocs: ExpiringDocsMetrics;
  isLoading?: boolean;
}

const SOURCE_ICON: Record<DocumentSource, React.ReactNode> = {
  pipeline_approval: <FolderKanban className="w-3 h-3" />,
  contractor_document: <Building2 className="w-3 h-3" />,
  agreement: <FileCheck className="w-3 h-3" />,
  project_requirement: <Calendar className="w-3 h-3" />,
  staff_document: <User className="w-3 h-3" />,
};

const SOURCE_HREF: Record<DocumentSource, (doc: ExpiringDocument) => string> = {
  pipeline_approval: (doc) => `/pipeline/${doc.project_id}`,
  contractor_document: (doc) => `/suppliers/${doc.contractor_id}`,
  agreement: (doc) => `/projects/${doc.project_id}?tab=agreements`,
  project_requirement: (doc) => `/projects/${doc.project_id}`,
  staff_document: (doc) => `/staff/${doc.staff_id}`,
};

export function ExpiringDocsCard({ expiringDocs, isLoading = false }: ExpiringDocsCardProps) {
  const [criticalDocs, setCriticalDocs] = useState<ExpiringDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Fetch critical documents for preview
  useEffect(() => {
    if (!isLoading && (expiringDocs.count30Days > 0 || expiringDocs.count60Days > 0)) {
      setLoadingDocs(true);
      fetch('/api/projects/expiring-documents?days=30')
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data?.all) {
            setCriticalDocs(data.data.all.slice(0, 3));
          }
        })
        .catch(() => { /* ignore */ })
        .finally(() => setLoadingDocs(false));
    }
  }, [isLoading, expiringDocs.count30Days, expiringDocs.count60Days]);

  if (isLoading) {
    return (
      <div className="ff-card animate-pulse">
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  const hasExpiredOrCritical = expiringDocs.count30Days > 0;
  const totalExpiring = expiringDocs.count30Days + expiringDocs.count60Days + expiringDocs.count90Days;

  return (
    <div className={`ff-card ${hasExpiredOrCritical ? 'ring-2 ring-red-500/30' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">
          Expiring Documents
        </h3>
        {hasExpiredOrCritical && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              Action Required
            </span>
          </div>
        )}
      </div>

      {totalExpiring === 0 ? (
        <div className="text-center py-4">
          <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            All documents are valid
          </p>
        </div>
      ) : (
        <>
          {/* Expiry timeline */}
          <div className="space-y-2 mb-4">
            {expiringDocs.count30Days > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-medium text-red-700 dark:text-red-300">
                    Critical (&lt;30 days)
                  </span>
                </div>
                <span className="text-lg font-bold text-red-600">{expiringDocs.count30Days}</span>
              </div>
            )}

            {expiringDocs.count60Days > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Warning (&lt;60 days)
                  </span>
                </div>
                <span className="text-lg font-bold text-amber-600">{expiringDocs.count60Days}</span>
              </div>
            )}

            {expiringDocs.count90Days > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Upcoming (&lt;90 days)
                  </span>
                </div>
                <span className="text-lg font-bold text-blue-600">{expiringDocs.count90Days}</span>
              </div>
            )}
          </div>

          {/* Critical documents preview */}
          {criticalDocs.length > 0 && !loadingDocs && (
            <div className="space-y-2 mb-4 pt-3 border-t border-[var(--ff-border-light)]">
              <p className="text-xs text-[var(--ff-text-secondary)] uppercase font-medium">
                Requires Attention
              </p>
              {criticalDocs.map((doc) => (
                <Link
                  key={`${doc.source}-${doc.id}`}
                  href={SOURCE_HREF[doc.source](doc)}
                  className="flex items-center justify-between p-2 rounded bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[var(--ff-text-secondary)]">
                      {SOURCE_ICON[doc.source]}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--ff-text-primary)] truncate">
                        {doc.document_type}
                      </p>
                      <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                        {doc.project_name || doc.contractor_name || doc.staff_name}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ml-2 ${
                    doc.days_until_expiry < 0
                      ? 'bg-red-100 dark:bg-red-900/30 text-red-600'
                      : doc.days_until_expiry <= 7
                      ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600'
                      : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
                  }`}>
                    {doc.days_until_expiry < 0
                      ? `${Math.abs(doc.days_until_expiry)}d overdue`
                      : `${doc.days_until_expiry}d`}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <Link
            href="/system/data-management/document-expiry"
            className="flex items-center justify-center gap-1 w-full py-2 text-sm font-medium text-[var(--ff-accent)] hover:text-[var(--ff-accent-hover)] transition-colors"
          >
            View all expiring documents
            <ChevronRight className="w-4 h-4" />
          </Link>
        </>
      )}
    </div>
  );
}

export default ExpiringDocsCard;
