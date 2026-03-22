import { useState, useCallback, useEffect } from 'react';
import {
  FolderOpen,
  Building2,
  Users,
  UserCheck,
  FileText,
  Truck,
  Wrench,
  AlertTriangle,
  Plus,
  BarChart3,
  Settings
} from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { QuickActionCard } from '@/components/dashboard/QuickActionCard';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { notificationService } from '@/services/core';
import { useDashboardData } from '@/hooks/useDashboardData';
import '../styles/design-system.css';

interface StatCardData {
  title: string;
  subtitle: string;
  value: string | number;
  subValue: string;
  icon: any;
  color: string;
  route?: string;
}

interface QuickActionData {
  title: string;
  description: string;
  icon: any;
  color: string;
  route?: string;
}

export function Dashboard() {
  // navigate removed - not used in current implementation
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { stats, isLoading, error, loadDashboardData } = useDashboardData();

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadDashboardData();
      notificationService.success('Dashboard data refreshed successfully');
    } catch (error) {
      notificationService.error('Failed to refresh dashboard data');
    } finally {
      setIsRefreshing(false);
    }
  }, [loadDashboardData]);

  const handleExport = useCallback(() => {
    notificationService.info('Export functionality coming soon');
  }, []);

  const statCards: StatCardData[] = [
    {
      title: 'Projects',
      subtitle: 'Manage and track all projects',
      value: stats.activeProjects || 0,
      subValue: `${stats.totalProjects || 0} Total Projects`,
      icon: FolderOpen,
      color: '#3b82f6',
      route: '/app/projects'
    },
    {
      title: 'Suppliers',
      subtitle: 'Supplier management and contacts',
      value: stats.supplierActive || 0,
      subValue: 'Active Suppliers',
      icon: Truck,
      color: '#10b981',
      route: '/app/suppliers'
    },
    {
      title: "RFQ's",
      subtitle: 'Request for Quotations',
      value: stats.rfqsActive || 0,
      subValue: 'Active RFQs',
      icon: FileText,
      color: '#374151',
      route: '/app/procurement'
    },
    {
      title: 'Clients',
      subtitle: 'Client information and projects',
      value: 1,
      subValue: 'Total Clients',
      icon: Building2,
      color: '#f97316',
      route: '/clients'
    },
    {
      title: 'Staff',
      subtitle: 'Staff members and management',
      value: stats.teamMembers || 0,
      subValue: 'Total Staff',
      icon: Users,
      color: '#f97316',
      route: '/app/staff'
    },
    {
      title: 'Contractors',
      subtitle: 'Contractor management and projects',
      value: stats.contractorsActive || 0,
      subValue: `${stats.contractorsPending || 0} Pending`,
      icon: UserCheck,
      color: '#3b82f6',
      route: '/app/contractors'
    },
    {
      title: 'Poles Installed',
      subtitle: 'Fiber optic pole installation tracking',
      value: stats.polesInstalled || 0,
      subValue: 'Poles Installed',
      icon: Wrench,
      color: '#10b981',
      route: '/app/pole-tracker'
    },
    {
      title: 'Flagged Issues',
      subtitle: 'High priority tasks requiring attention',
      value: stats.openIssues || 0,
      subValue: 'Issues to Resolve',
      icon: AlertTriangle,
      color: '#ef4444',
      route: '/app/action-items'
    }
  ];

  const quickActions: QuickActionData[] = [
    {
      title: 'Create New Project',
      description: 'Set up a new fiber optic project with all required configurations and initial planning documents.',
      icon: Plus,
      color: '#3b82f6',
      route: '/app/projects/new'
    },
    {
      title: 'Add Staff Member',
      description: 'Onboard a new team member with role assignment, contact details, and project access permissions.',
      icon: Users,
      color: '#10b981',
      route: '/app/staff/new'
    },
    {
      title: 'Generate Report',
      description: 'Create comprehensive project reports, analytics dashboards, and export data for stakeholders.',
      icon: BarChart3,
      color: '#f97316',
      route: '/app/reports'
    },
    {
      title: 'System Settings',
      description: 'Configure application preferences, user permissions, and system-wide settings for optimal performance.',
      icon: Settings,
      color: '#6b7280',
      route: '/app/settings'
    }
  ];

  return (
    <div className="min-h-full bg-background py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Dashboard Header */}
        <DashboardHeader 
          onRefresh={handleRefresh}
          onExport={handleExport}
          isRefreshing={isRefreshing}
        />

        {/* Stats Grid - Responsive */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((card, index) => (
            <StatCard
              key={index}
              title={card.title}
              subtitle={card.subtitle}
              value={card.value}
              subValue={card.subValue}
              icon={card.icon}
              color={card.color}
              route={card.route}
              className="ff-animate-fade-in"
              style={{ animationDelay: `${index * 100}ms` }}
            />
          ))}
        </div>

        {/* Additional Dashboard Content */}
        <div className="mt-12 space-y-8">
          {/* Recent Activity */}
          <div className="bg-card rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-muted-foreground">New project "Lawley" created</span>
                </div>
                <span className="text-xs text-muted-foreground">2 hours ago</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-sm text-muted-foreground">Staff member "John Doe" added</span>
                </div>
                <span className="text-xs text-muted-foreground">4 hours ago</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span className="text-sm text-muted-foreground">BOQ updated for Mamelodi POP 1</span>
                </div>
                <span className="text-xs text-muted-foreground">6 hours ago</span>
              </div>
            </div>
          </div>

          {/* Quick Actions - Full Width for Better Display */}
          <div className="ff-quick-actions-container bg-card rounded-xl shadow-sm border border-border p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-semibold text-foreground">Quick Actions</h3>
                <p className="text-sm text-muted-foreground mt-1">Frequently used actions to boost productivity</p>
              </div>
              <div className="text-xs text-gray-400 bg-background px-3 py-1 rounded-full">
                {quickActions.length} actions
              </div>
            </div>
            <div className="ff-quick-actions-grid">
              {quickActions.map((action, index) => (
                <QuickActionCard
                  key={index}
                  title={action.title}
                  description={action.description}
                  icon={action.icon}
                  color={action.color}
                  route={action.route}
                  className="ff-animate-fade-in"
                  style={{ animationDelay: `${index * 75}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}