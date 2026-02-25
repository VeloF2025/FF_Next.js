import { useState, useEffect } from 'react';
import { formatDisplayDateLong } from '@/utils/dateFormat';
import { Calendar, FolderOpen, Users, CheckCircle, AlertTriangle, MapPin, TrendingUp } from 'lucide-react';
import { ProjectOverviewCard } from './components/ProjectOverviewCard';
import { RecentActivityFeed } from './components/RecentActivityFeed';
import { QuickActions } from './components/QuickActions';
import { StaleProjectsWidget } from './components/StaleProjectsWidget';
import { StatsGrid } from '../../components/dashboard/EnhancedStatCard';
import { useMainDashboardData } from '../../hooks/useDashboardData';
import { getMainDashboardCards } from '../../config/dashboards/dashboardConfigs';
import { useAuth } from '../../contexts/AuthContext';
import { Permission } from '../../types/auth.types';

// 🟢 WORKING: All data from real database sources - zero mock data

export function Dashboard() {
  const { currentUser, hasPermission } = useAuth();
  const {
    stats,
    trends,

    formatNumber,
    formatCurrency,
    formatPercentage
  } = useMainDashboardData();

  // Fix hydration: only render time-dependent content after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const getGreeting = () => {
    if (!mounted) return 'Welcome';
    const hour = new Date().getHours();
    const name = currentUser?.displayName?.split(' ')[0] || 'there';

    if (hour < 12) return `Good Morning, ${name}`;
    if (hour < 17) return `Good Afternoon, ${name}`;
    return `Good Evening, ${name}`;
  };

  const getFormattedDate = () => {
    if (!mounted) return '';
    return formatDisplayDateLong(new Date());
  };

  // 🟢 WORKING: Get dashboard cards configuration
  const dashboardCards = getMainDashboardCards(
    stats, 
    trends, 
    { formatNumber, formatCurrency, formatPercentage }
  );

  // 🟢 WORKING: Use real data from database hook (dashboardCards already uses real data)
  const statsCards = [
    {
      title: 'Active Projects',
      value: stats.activeProjects,
      icon: FolderOpen,
      description: 'Total projects data not available',
      trend: trends?.activeProjects ? {
        value: trends.activeProjects.percentage,
        isPositive: trends.activeProjects.direction === 'up',
        label: 'vs last month',
      } : { value: 0, isPositive: true, label: 'no trend data' },
      variant: 'primary' as const,
      requiredPermissions: [Permission.PROJECTS_READ],
    },
    {
      title: 'Team Members',
      value: stats.teamMembers,
      icon: Users,
      description: 'Active staff members',
      trend: trends?.teamMembers ? {
        value: trends.teamMembers.percentage,
        isPositive: trends.teamMembers.direction === 'up',
        label: 'change this month',
      } : { value: 0, isPositive: true, label: 'no trend data' },
      variant: 'success' as const,
      requiredPermissions: [Permission.STAFF_READ],
    },
    {
      title: 'Tasks Completed',
      value: stats.completedTasks,
      icon: CheckCircle,
      description: stats.completedTasks > 0 ? 'From all projects' : 'No tasks tracked yet',
      trend: trends?.completedTasks ? {
        value: trends.completedTasks.percentage,
        isPositive: trends.completedTasks.direction === 'up',
        label: 'vs last week',
      } : { value: 0, isPositive: true, label: 'no trend data' },
      variant: 'success' as const,
      requiredPermissions: [Permission.PROJECTS_READ],
    },
    {
      title: 'Open Issues',
      value: stats.openIssues,
      icon: AlertTriangle,
      description: stats.openIssues === 0 ? 'No issues found' : 'Issues tracked',
      trend: trends?.openIssues ? {
        value: trends.openIssues.percentage,
        isPositive: trends.openIssues.direction === 'down', // Down is good for issues
        label: 'requires attention',
      } : { value: 0, isPositive: true, label: 'no trend data' },
      variant: stats.openIssues > 0 ? 'warning' : 'success',
      requiredPermissions: [Permission.VIEW_COMMUNICATIONS],
    },
    {
      title: 'Poles Installed',
      value: stats.polesInstalled,
      icon: MapPin,
      description: stats.polesInstalled === 0 ? 'No installations tracked' : 'Infrastructure deployed',
      trend: trends?.polesInstalled ? {
        value: trends.polesInstalled.percentage,
        isPositive: trends.polesInstalled.direction === 'up',
        label: 'infrastructure growth',
      } : { value: 0, isPositive: true, label: 'no trend data' },
      variant: 'primary' as const,
      requiredPermissions: [Permission.PROJECTS_READ],
    },
  ];

  // Filter stats based on permissions
  const visibleStats = statsCards.filter(stat => 
    stat.requiredPermissions.length === 0 || 
    stat.requiredPermissions.some(permission => hasPermission(permission))
  );

  return (
    <div className="space-y-6 p-6">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-lg p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-2">
              {getGreeting()}
            </h1>
            <p className="text-primary-100">
              Welcome to your FibreFlow dashboard. Here's what's happening with your projects.
            </p>
          </div>
          <div className="hidden lg:flex items-center space-x-4 text-right">
            <div>
              <div className="text-sm text-primary-200">Today</div>
              <div className="font-semibold">
                {getFormattedDate()}
              </div>
            </div>
            <div className="w-12 h-12 bg-card/20 rounded-lg flex items-center justify-center">
              <Calendar className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Enhanced Stats Grid */}
      <StatsGrid 
        cards={dashboardCards.filter(card => {
          // Filter cards based on user permissions similar to original logic
          if (card.route?.includes('/projects')) return hasPermission(Permission.PROJECTS_READ);
          if (card.route?.includes('/staff')) return hasPermission(Permission.STAFF_READ);
          if (card.route?.includes('/tasks')) return hasPermission(Permission.PROJECTS_READ);
          if (card.route?.includes('/issues')) return hasPermission(Permission.VIEW_COMMUNICATIONS);
          if (card.route?.includes('/analytics')) return hasPermission(Permission.ANALYTICS_READ);
          return true; // Default to showing the card
        })}
        columns={3}
        className="mb-6"
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projects Overview - Takes 2 columns */}
        {hasPermission(Permission.PROJECTS_READ) && (
          <div className="lg:col-span-2">
            <ProjectOverviewCard />
          </div>
        )}

        {/* Quick Actions - Takes 1 column */}
        <div className={hasPermission(Permission.PROJECTS_READ) ? '' : 'lg:col-span-3'}>
          <QuickActions />
        </div>
      </div>

      {/* Recent Activity - Full Width */}
      {hasPermission(Permission.VIEW_COMMUNICATIONS) && (
        <div className="grid grid-cols-1">
          <RecentActivityFeed />
        </div>
      )}

      {/* Stale Projects Alert Widget */}
      {hasPermission(Permission.PROJECTS_READ) && (
        <StaleProjectsWidget />
      )}

      {/* Additional KPI Cards for Analytics Users */}
      {hasPermission(Permission.ANALYTICS_READ) && (
        <div className="bg-[var(--ff-surface-primary)] rounded-lg border border-[var(--ff-border-primary)] p-6">
          <div className="flex items-center space-x-2 mb-4">
            <TrendingUp className="w-5 h-5 text-primary-600" />
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Performance Metrics
            </h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[var(--ff-surface-secondary)] rounded-lg p-4">
              <div className="text-2xl font-bold text-success-600">
                {stats.qualityScore > 0 ? formatPercentage(stats.qualityScore) : '0%'}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Quality Score</div>
            </div>
            <div className="bg-[var(--ff-surface-secondary)] rounded-lg p-4">
              <div className="text-2xl font-bold text-primary-600">
                {stats.onTimeDelivery > 0 ? formatPercentage(stats.onTimeDelivery) : '0%'}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">On-Time Delivery</div>
            </div>
            <div className="bg-[var(--ff-surface-secondary)] rounded-lg p-4">
              <div className="text-2xl font-bold text-warning-600">
                {stats.performanceScore > 0 ? formatPercentage(stats.performanceScore) : '0%'}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Performance Score</div>
            </div>
            <div className="bg-[var(--ff-surface-secondary)] rounded-lg p-4">
              <div className="text-2xl font-bold text-info-600">
                {stats.totalRevenue > 0 ? formatCurrency(stats.totalRevenue) : 'R0'}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Total Revenue</div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State for Limited Permissions */}
      {visibleStats.length === 0 && (
        <div className="bg-[var(--ff-surface-primary)] rounded-lg border border-[var(--ff-border-primary)] p-12 text-center">
          <div className="w-16 h-16 bg-[var(--ff-surface-secondary)] rounded-full flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-8 h-8 text-[var(--ff-text-tertiary)]" />
          </div>
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
            Welcome to FibreFlow
          </h3>
          <p className="text-[var(--ff-text-secondary)] mb-4">
            Your dashboard will display relevant information once you have access to project data.
          </p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">
            Contact your administrator to request additional permissions.
          </p>
        </div>
      )}
    </div>
  );
}