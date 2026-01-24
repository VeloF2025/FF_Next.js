/**
 * System Health Hub
 *
 * Unified system monitoring dashboard with 4 tabs:
 * - Overview: Aggregated health status
 * - Infrastructure: Service details
 * - QField: QField sync status
 * - Self-Healing: Auto-recovery controls
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { Permission } from '@/types/auth.types';
import OverviewDashboard from '@/modules/system/components/OverviewDashboard';
import InfrastructureDashboard from '@/modules/system/components/InfrastructureDashboard';
import SelfHealingDashboard from '@/modules/system/components/SelfHealingDashboard';
import { Activity, Server, GitBranch, Bot, RefreshCw, AlertTriangle } from 'lucide-react';
import type { DashboardTab } from '@/modules/system/types/self-healing.types';

const TABS: { id: DashboardTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'infrastructure', label: 'Infrastructure', icon: Server },
  { id: 'qfield', label: 'QField', icon: GitBranch },
  { id: 'self-healing', label: 'Self-Healing', icon: Bot },
];

const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds

export default function SystemHealthHub() {
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Check permissions
  const hasAccess = hasPermission(Permission.SYSTEM_ADMIN) || user?.role === 'super_admin';

  // Handle URL tab parameter
  useEffect(() => {
    const { tab } = router.query;
    if (tab && typeof tab === 'string' && TABS.some((t) => t.id === tab)) {
      setActiveTab(tab as DashboardTab);
    }
  }, [router.query]);

  // Update URL when tab changes
  const handleTabChange = (tab: DashboardTab) => {
    setActiveTab(tab);
    router.push({ pathname: '/system/health', query: { tab } }, undefined, { shallow: true });
  };

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      handleRefresh();
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setLastRefresh(new Date());
    // Child components will pick up on this via key prop
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  if (!hasAccess) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <h1 className="text-2xl font-semibold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400">
              You don't have permission to view the System Health Hub.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Head>
        <title>System Health Hub | FibreFlow</title>
      </Head>

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">System Health Hub</h1>
            <p className="text-gray-400 text-sm mt-1">
              Monitor infrastructure, QField, and self-healing systems
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Auto-refresh toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
              />
              Auto-refresh
            </label>

            {/* Last refresh time */}
            <span className="text-sm text-gray-500">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600
                         text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-700">
          <nav className="flex gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                    ${isActive
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div key={lastRefresh.getTime()}>
          {activeTab === 'overview' && <OverviewDashboard />}
          {activeTab === 'infrastructure' && <InfrastructureDashboard />}
          {activeTab === 'qfield' && <QFieldPlaceholder />}
          {activeTab === 'self-healing' && <SelfHealingDashboard />}
        </div>
      </div>
    </AppLayout>
  );
}

// Placeholder for QField tab (existing functionality)
function QFieldPlaceholder() {
  return (
    <div className="bg-gray-800 rounded-lg p-6 text-center">
      <GitBranch className="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-white mb-2">QField Sync Status</h3>
      <p className="text-gray-400 mb-4">
        QField synchronization monitoring coming soon.
      </p>
      <a
        href="/admin/qfield-sync"
        className="text-blue-400 hover:text-blue-300"
      >
        View existing QField admin →
      </a>
    </div>
  );
}
