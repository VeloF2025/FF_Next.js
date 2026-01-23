/**
 * Fleet Drivers Page
 * Unified page with 4 tabs: Dashboard, Drivers List, Leaderboard, Scorecards
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { notificationService } from '@/services/core/NotificationService';
import {
  BarChart3,
  Users,
  Trophy,
  ClipboardList,
  FileText,
} from 'lucide-react';
import {
  DashboardTab,
  DriversListTab,
  LeaderboardTab,
  ScorecardTab,
  DriversDocumentsTab,
} from '@/modules/fleet/components/drivers';
import type { FleetDriver, DriverDashboardStats } from '@/modules/fleet/types/driver.types';

type TabId = 'dashboard' | 'drivers' | 'leaderboard' | 'scorecards' | 'documents';

const tabs: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'drivers', label: 'Drivers', icon: Users },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'scorecards', label: 'Scorecards', icon: ClipboardList },
];

export default function FleetDriversPage() {
  const router = useRouter();

  // Get tab and staffId from URL
  const activeTab = (router.query.tab as TabId) || 'dashboard';
  const selectedStaffId = router.query.staffId as string | undefined;

  // Data state
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [stats, setStats] = useState<DriverDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);

  // Fetch drivers data
  useEffect(() => {
    async function fetchDrivers() {
      setLoading(true);
      try {
        // Always fetch with includeFormer to have all data available
        const res = await fetch('/api/fleet/drivers?includeFormer=true');
        if (!res.ok) throw new Error('Failed to fetch drivers');
        const data = await res.json();
        setDrivers(data.data.drivers);
        setStats(data.data.summary);
      } catch (err) {
        notificationService.error('Failed to load drivers data');
      } finally {
        setLoading(false);
      }
    }

    fetchDrivers();
  }, []);

  // Handle tab change
  const handleTabChange = useCallback((tabId: TabId) => {
    const query: Record<string, string> = { tab: tabId };
    // Preserve staffId when switching to scorecards tab
    if (tabId === 'scorecards' && selectedStaffId) {
      query.staffId = selectedStaffId;
    }
    router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [router, selectedStaffId]);

  // Handle scorecard selection (from drivers list or leaderboard)
  const handleViewScorecard = useCallback((staffId: string) => {
    router.replace(
      { pathname: router.pathname, query: { tab: 'scorecards', staffId } },
      undefined,
      { shallow: true }
    );
  }, [router]);

  // Handle clearing scorecard selection
  const handleSelectDriver = useCallback((staffId: string | null) => {
    if (staffId) {
      router.replace(
        { pathname: router.pathname, query: { tab: 'scorecards', staffId } },
        undefined,
        { shallow: true }
      );
    } else {
      router.replace(
        { pathname: router.pathname, query: { tab: 'scorecards' } },
        undefined,
        { shallow: true }
      );
    }
  }, [router]);

  // Handle recalculate scores
  const handleRecalculateScores = async () => {
    setCalculating(true);
    try {
      const res = await fetch('/api/fleet/drivers/calculate-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: 'monthly' }),
      });

      if (!res.ok) throw new Error('Failed to calculate scores');

      const data = await res.json();
      const count = data.data.count;

      if (count === 0) {
        notificationService.info('No drivers with activity found');
      } else {
        notificationService.success(`Calculated scores for ${count} driver${count !== 1 ? 's' : ''}`);
      }

      // Refresh data
      const refreshRes = await fetch('/api/fleet/drivers?includeFormer=true');
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setDrivers(refreshData.data.drivers);
        setStats(refreshData.data.summary);
      }
    } catch {
      notificationService.error('Failed to calculate scores');
    } finally {
      setCalculating(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Users className="w-7 h-7 text-[var(--ff-primary)]" />
            Fleet Drivers
          </h1>
          <p className="text-[var(--ff-text-secondary)]">
            Manage drivers, view performance rankings, and track compliance
          </p>
        </div>

        {/* Tab Bar */}
        <div className="border-b border-[var(--ff-border-light)]">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`
                    flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                    ${isActive
                      ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
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
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--ff-primary)]"></div>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && stats && (
              <DashboardTab
                stats={stats}
                onRecalculateScores={handleRecalculateScores}
                calculating={calculating}
              />
            )}

            {activeTab === 'drivers' && (
              <DriversListTab
                drivers={drivers}
                onViewScorecard={handleViewScorecard}
              />
            )}

            {activeTab === 'leaderboard' && (
              <LeaderboardTab onViewScorecard={handleViewScorecard} />
            )}

            {activeTab === 'scorecards' && (
              <ScorecardTab
                staffId={selectedStaffId || null}
                drivers={drivers}
                onSelectDriver={handleSelectDriver}
              />
            )}

            {activeTab === 'documents' && (
              <DriversDocumentsTab />
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
