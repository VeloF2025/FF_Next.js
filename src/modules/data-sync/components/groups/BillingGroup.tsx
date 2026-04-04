/**
 * Billing Group Component
 * Wraps FiberTime billing reconciliation tabs: Upload, Weekly Summary, DR Status
 */

'use client';

import React, { useEffect, useMemo } from 'react';
import { Upload, BarChart3, CreditCard, Lock } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { BillingTabId } from '../../types';
import { usePermission } from '@/hooks/usePermission';

// Import billing tab components
import { BillingUploadTab } from '@/modules/billing/components/BillingUploadTab';
import { WeeklySummaryTab } from '@/modules/billing/components/WeeklySummaryTab';
import { DRPaymentStatusTab } from '@/modules/billing/components/DRPaymentStatusTab';

// Tab configuration with permission keys
const TABS: { id: BillingTabId; label: string; icon: React.ElementType; permissionKey: string }[] = [
  { id: 'upload',    label: 'Upload',         icon: Upload,     permissionKey: 'system.data-sync.billing.upload' },
  { id: 'summary',   label: 'Weekly Summary', icon: BarChart3,  permissionKey: 'system.data-sync.billing.summary' },
  { id: 'dr-status', label: 'DR Status',      icon: CreditCard, permissionKey: 'system.data-sync.billing.dr-status' },
];

interface BillingGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function BillingGroup({ activeTab, onTabChange }: BillingGroupProps) {
  const { can, isLoading: permissionsLoading } = usePermission();

  // Filter tabs based on permissions
  const accessibleTabs = useMemo(() => {
    if (permissionsLoading) return [];
    return TABS.filter((tab) => can(tab.permissionKey, 'view'));
  }, [permissionsLoading, can]);

  // Default to first accessible tab
  const currentTab = useMemo(() => {
    const requested = activeTab as BillingTabId;
    if (accessibleTabs.some((t) => t.id === requested)) {
      return requested;
    }
    return accessibleTabs[0]?.id || 'upload';
  }, [activeTab, accessibleTabs]);

  // Sync URL with active tab on mount
  useEffect(() => {
    const firstTab = accessibleTabs[0];
    if (!activeTab && firstTab) {
      onTabChange(firstTab.id);
    }
  }, [activeTab, onTabChange, accessibleTabs]);

  // Show loading state
  if (permissionsLoading) {
    return (
      <LoadingSpinner className="py-16" size="lg" label="Loading..." />
    );
  }

  // Show access denied if no tabs accessible
  if (accessibleTabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Access Restricted</h2>
        <p className="text-[var(--ff-text-secondary)] max-w-md">
          You don&apos;t have permission to access any Billing tabs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Billing Tabs">
          {accessibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${
                    isActive
                      ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {currentTab === 'upload' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Weekly Billing Upload
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Upload FiberTime payment summary PDF and optional notes XLSX to create a weekly billing record
            </p>
          </div>
          <BillingUploadTab />
        </div>
      )}

      {currentTab === 'summary' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Weekly Billing Summary
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Overview of all weekly billing records with reconciliation status and payment metrics
            </p>
          </div>
          <WeeklySummaryTab />
        </div>
      )}

      {currentTab === 'dr-status' && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              DR Payment Status
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              View deductions from the latest billing week, broken down by note type and DR number
            </p>
          </div>
          <DRPaymentStatusTab />
        </div>
      )}
    </div>
  );
}
