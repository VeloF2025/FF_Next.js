/**
 * /field — Field Workers admin portal.
 *
 * Renders inside the standard AppLayout (same as /staff/* pages).
 * Tabs: Approvals | Time (Time tab is added in Task 5).
 *
 * Auth: reads `hasAnyRole` from useAuth() to determine admin status.
 * Admin roles: SUPER_ADMIN, ADMIN.
 */

import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types/auth.types';
import { ApprovalsTab } from '@/modules/field-workers/components/ApprovalsTab';

type Tab = 'approvals' | 'time';

const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'approvals', label: 'Approvals' },
  { key: 'time', label: 'Time' },
];

const ADMIN_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

export default function FieldWorkersPage() {
  const [activeTab, setActiveTab] = useState<Tab>('approvals');
  const { hasAnyRole } = useAuth();

  const isAdmin = hasAnyRole(ADMIN_ROLES);

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-neutral-100">Field Workers</h1>
          <p className="text-sm text-neutral-400">
            Manage field-worker registrations and attendance.
          </p>
        </header>

        {/* Tab bar */}
        <nav role="tablist" aria-label="Field workers sections" className="flex gap-2 flex-wrap">
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-1.5 rounded-full border text-sm font-medium transition ${
                  isActive
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-600'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Tab panels */}
        {activeTab === 'approvals' && (
          <div role="tabpanel" aria-label="Approvals">
            <ApprovalsTab isAdmin={isAdmin} />
          </div>
        )}

        {activeTab === 'time' && (
          <div role="tabpanel" aria-label="Time">
            <p className="text-neutral-500 text-sm py-6 text-center">
              Time & attendance view — coming in Task 5.
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
