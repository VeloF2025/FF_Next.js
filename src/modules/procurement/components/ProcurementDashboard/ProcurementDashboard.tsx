/**
 * Procurement Dashboard Component - Enhanced with comprehensive metrics
 * Features procurement stats, BOQ/RFQ tracking, and supplier management
 */

import { useState, useEffect } from 'react';
import { Plus, Download, RefreshCw } from 'lucide-react';
import { ProcurementErrorBoundary } from '../error/ProcurementErrorBoundary';
import { QuickActions } from './components/QuickActions';
import { ModuleStatusNotice } from './components/ModuleStatusNotice';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { useProcurementDashboardData } from '@/hooks/useDashboardData';
import { getProcurementDashboardCards } from '@/config/dashboards/dashboardConfigs';
import { quickActions } from './data/dashboardData';
import { log } from '@/lib/logger';

interface RecentActivity {
  id: string;
  type: string;
  action: string;
  item: string;
  timestamp: string;
  value?: number;
}

export function ProcurementDashboard() {
  const [activeView, setActiveView] = useState<'overview' | 'detailed'>('overview');
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  const {
    stats,
    trends,
    isLoading,
    error,
    formatNumber,
    formatCurrency,
    formatPercentage,
    loadDashboardData
  } = useProcurementDashboardData();

  // Fetch recent procurement activities from real API
  useEffect(() => {
    const loadRecentActivities = async () => {
      try {
        setActivitiesLoading(true);
        // Fetch recent POs, RFQs, and BOQs to show as activities
        const [posRes, rfqsRes, boqsRes] = await Promise.all([
          fetch('/api/procurement/purchase-orders?limit=5'),
          fetch('/api/procurement/rfq?limit=5'),
          fetch('/api/procurement/boq?limit=5')
        ]);

        const activities: RecentActivity[] = [];

        if (posRes.ok) {
          const posData = await posRes.json();
          (posData.data || posData.purchaseOrders || []).slice(0, 3).forEach((po: any) => {
            activities.push({
              id: `po-${po.id}`,
              type: 'PO',
              action: po.status === 'approved' ? 'approved' : 'created',
              item: `${po.po_number || po.poNumber} - ${po.supplier_name || po.supplierName || 'Supplier'}`,
              timestamp: formatTimeAgo(po.created_at || po.createdAt),
              value: Number(po.total_amount || po.totalAmount || 0)
            });
          });
        }

        if (rfqsRes.ok) {
          const rfqsData = await rfqsRes.json();
          const rfqsList = rfqsData.data?.rfqs || rfqsData.rfqs || [];
          rfqsList.slice(0, 2).forEach((rfq: any) => {
            activities.push({
              id: `rfq-${rfq.id}`,
              type: 'RFQ',
              action: rfq.status === 'open' ? 'issued' : 'created',
              item: `${rfq.rfqNumber || rfq.id} - ${rfq.title}`,
              timestamp: formatTimeAgo(rfq.createdDate || rfq.createdAt),
              value: rfq.totalValue
            });
          });
        }

        if (boqsRes.ok) {
          const boqsData = await boqsRes.json();
          (boqsData.boqs || []).slice(0, 2).forEach((boq: any) => {
            activities.push({
              id: `boq-${boq.id}`,
              type: 'BOQ',
              action: 'uploaded',
              item: boq.title || boq.file_name || 'BOQ Document',
              timestamp: formatTimeAgo(boq.created_at || boq.createdAt)
            });
          });
        }

        // Sort by most recent (approximation since we're using relative times)
        setRecentActivities(activities.slice(0, 5));
      } catch (err) {
        log.error('Failed to load recent activities:', { data: err }, 'ProcurementDashboard');
      } finally {
        setActivitiesLoading(false);
      }
    };

    loadRecentActivities();
  }, []);

  // Helper to format time ago
  const formatTimeAgo = (dateStr: string): string => {
    if (!dateStr) return 'Recently';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  // Get procurement dashboard cards with real stats
  const procurementCards = getProcurementDashboardCards(
    stats,
    trends,
    { formatNumber, formatCurrency, formatPercentage }
  );

  return (
    <ProcurementErrorBoundary level="page">
      <div className="ff-page-container">
        <DashboardHeader 
          title="Procurement Dashboard"
          subtitle="Manage procurement processes, BOQs, RFQs and supplier relationships"
          actions={[
            {
              label: 'Create BOQ',
              icon: Plus as React.ComponentType<{ className?: string; }>,
              onClick: () => window.location.href = '/app/procurement/boq/create',
              variant: 'primary'
            },
            {
              label: 'Export Report',
              icon: Download as React.ComponentType<{ className?: string; }>,
              onClick: () => {
                // Export procurement stats as CSV
                const headers = ['Metric', 'Value'];
                const rows = [
                  ['BOQs Active', stats.boqsActive || 0],
                  ['RFQs Active', stats.rfqsActive || 0],
                  ['Suppliers Active', stats.supplierActive || 0],
                  ['Budget Utilization', stats.budgetUtilization || 0],
                  ['Open Issues', stats.openIssues || 0],
                ];
                const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `procurement-report-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              },
              variant: 'secondary'
            },
            {
              label: 'Refresh Data',
              icon: RefreshCw as React.ComponentType<{ className?: string; }>,
              onClick: loadDashboardData,
              variant: 'secondary'
            }
          ]}
        />

        {/* View Toggle */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
            <button
              onClick={() => setActiveView('overview')}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                activeView === 'overview' 
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:text-gray-100'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveView('detailed')}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                activeView === 'detailed' 
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:text-gray-100'
              }`}
            >
              Detailed View
            </button>
          </div>
        </div>

        {/* Enhanced Procurement Stats Cards */}
        <StatsGrid 
          cards={procurementCards}
          columns={3}
          className="mb-8"
        />

        {/* Quick Actions Section */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Quick Actions</h3>
          </div>
          <QuickActions actions={quickActions} />
        </div>

        {/* Recent Activities and Stats Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent Activities - Real Data */}
          <div className="ff-card">
            <div className="p-6">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Activity</h4>
              {activitiesLoading ? (
                <div className="text-center py-4 text-gray-500 dark:text-gray-400">Loading activities...</div>
              ) : recentActivities.length > 0 ? (
                <div className="space-y-3">
                  {recentActivities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-center justify-between p-3 hover:bg-gray-50 dark:bg-gray-900 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          activity.type === 'PO' ? 'bg-orange-100' :
                          activity.type === 'RFQ' ? 'bg-green-100' :
                          activity.type === 'BOQ' ? 'bg-blue-100' : 'bg-gray-100 dark:bg-gray-800'
                        }`}>
                          <span className={`text-xs font-bold ${
                            activity.type === 'PO' ? 'text-orange-600' :
                            activity.type === 'RFQ' ? 'text-green-600' :
                            activity.type === 'BOQ' ? 'text-blue-600' : 'text-gray-600 dark:text-gray-400'
                          }`}>{activity.type}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{activity.item}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{activity.action} - {activity.timestamp}</p>
                        </div>
                      </div>
                      {activity.value !== undefined && activity.value > 0 && (
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          R {activity.value.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500 dark:text-gray-400">No recent activity</div>
              )}
            </div>
          </div>

          {/* Process Status - Real Stats */}
          <div className="ff-card">
            <div className="p-6">
              <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Process Status</h4>
              {isLoading ? (
                <div className="text-center py-4 text-gray-500 dark:text-gray-400">Loading stats...</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                    <span className="text-sm font-medium text-blue-900">BOQs in Review</span>
                    <span className="font-semibold text-blue-600">{stats.boqsActive || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                    <span className="text-sm font-medium text-purple-900">RFQs Active</span>
                    <span className="font-semibold text-purple-600">{stats.rfqsActive || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <span className="text-sm font-medium text-green-900">Suppliers Verified</span>
                    <span className="font-semibold text-green-600">{stats.supplierActive || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                    <span className="text-sm font-medium text-yellow-900">Pending Approvals</span>
                    <span className="font-semibold text-yellow-600">{stats.openIssues || 0}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <ModuleStatusNotice />
      </div>
    </ProcurementErrorBoundary>
  );
}