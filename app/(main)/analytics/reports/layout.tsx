/**
 * Analytics Reports Layout — shared layout for Financial + Operations sub-pages.
 * Contains the page header and horizontal tab navigation.
 * Tabs are gated by sub-page RBAC keys — hidden if user lacks permission.
 * 🟢 WORKING: Tab active state detected from pathname, RBAC-filtered
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart2, Lock } from 'lucide-react';
import { ModulePage } from '@/components/module-page';
import { analyticsConfig } from '@/modules/navigation';
import { usePermission } from '@/hooks/usePermission';

const ALL_TABS = [
  { label: 'Financial',   href: '/analytics/reports/financial',  rbacKey: 'analytics.reports.financial'  },
  { label: 'Operations',  href: '/analytics/reports/operations', rbacKey: 'analytics.reports.operations' },
];

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = usePermission();

  // Only show tabs the user has view access to
  const visibleTabs = ALL_TABS.filter(tab => can(tab.rbacKey, 'view'));

  return (
    <ModulePage config={analyticsConfig}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <BarChart2 className="w-7 h-7 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Reports Sandbox</h1>
            <p className="text-sm text-gray-400 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Restricted — Internal use only
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-gray-700 mb-6">
          {visibleTabs.map((tab) => {
            const isActive = pathname?.startsWith(tab.href) ?? false;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'border-b-2 border-blue-500 text-white font-semibold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {children}
      </div>
    </ModulePage>
  );
}
