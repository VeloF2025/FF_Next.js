/**
 * Expiring Documents Card (PRD-058)
 * Displays document expiry alerts by timeframe
 */

import React from 'react';
import Link from 'next/link';
import { ExclamationTriangleIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { ExpiringDocsMetrics } from './types';

interface ExpiringDocsCardProps {
  expiringDocs: ExpiringDocsMetrics;
  isLoading?: boolean;
}

export function ExpiringDocsCard({ expiringDocs, isLoading = false }: ExpiringDocsCardProps) {
  if (isLoading) {
    return (
      <div className="ff-card animate-pulse">
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  const hasUrgent = expiringDocs.count30Days > 0;
  const totalExpiring = expiringDocs.count30Days + expiringDocs.count60Days + expiringDocs.count90Days;

  return (
    <div className={`ff-card ${hasUrgent ? 'ring-2 ring-red-500/30' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">
          Expiring Documents
        </h3>
        {hasUrgent && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30">
            <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
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
          <div className="space-y-3 mb-4">
            {expiringDocs.count30Days > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-medium text-red-700 dark:text-red-300">
                    Within 30 days
                  </span>
                </div>
                <span className="text-lg font-bold text-red-600">{expiringDocs.count30Days}</span>
              </div>
            )}

            {expiringDocs.count60Days > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Within 60 days
                  </span>
                </div>
                <span className="text-lg font-bold text-amber-600">{expiringDocs.count60Days}</span>
              </div>
            )}

            {expiringDocs.count90Days > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Within 90 days
                  </span>
                </div>
                <span className="text-lg font-bold text-blue-600">{expiringDocs.count90Days}</span>
              </div>
            )}
          </div>

          <Link
            href="/system/data-management/document-expiry"
            className="flex items-center justify-center gap-1 w-full py-2 text-sm font-medium text-[var(--ff-primary)] hover:text-[var(--ff-primary-dark)] transition-colors"
          >
            View all expiring documents
            <ChevronRightIcon className="w-4 h-4" />
          </Link>
        </>
      )}
    </div>
  );
}

export default ExpiringDocsCard;
