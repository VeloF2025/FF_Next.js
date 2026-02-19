/**
 * Procurement Audit Log Browser
 * Full-page view of all procurement audit trail entries
 */

import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import { AuditLogTable, AuditActivitySummary } from '@/modules/procurement/audit';
import { ShoppingCart, ScrollText } from 'lucide-react';

export default function AuditLogPage() {
  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Module Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2">
                <ShoppingCart className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Procurement</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Manage procurement across all projects
                </p>
              </div>
            </div>
          </div>

          {/* Main Category Tab Navigation */}
          <div className="border-t border-[var(--ff-border-light)] px-6">
            <ProcurementTabs activeTab="reports" categoriesOnly />
          </div>
        </div>

        {/* Sub-page Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-3">
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-blue-500" />
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Audit Trail</h2>
            </div>
            <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
              Complete history of all procurement actions
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-6">
            <AuditActivitySummary />
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <AuditLogTable />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
