/**
 * Dashboard Configurations - Centralized configuration for all dashboard cards
 * Provides consistent card configurations across different dashboard types
 */

import {
  FolderOpen, Users, CheckCircle, AlertTriangle, TrendingUp, Calendar,
  MapPin, Wifi, Activity, DollarSign, FileText,
  BarChart3, PieChart, Target, Clock, Truck, ShoppingCart,
  UserCheck, ClipboardList, Shield, Award, Database
} from 'lucide-react';
import { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';

/** Numeric dashboard stats keyed by metric name */
export type DashboardStats = Record<string, number>;

/** Trend direction data keyed by metric name */
export type DashboardTrends = Record<string, EnhancedStatCardProps['trend']>;

/** Value formatter functions used across dashboard cards */
export interface DashboardFormatters {
  formatNumber: (value: number | string) => string;
  formatCurrency: (value: number | string) => string;
  formatPercentage: (value: number | string) => string;
}

// 🟢 WORKING: Main Dashboard card configurations
export const getMainDashboardCards = (stats: DashboardStats, trends: DashboardTrends, formatters: DashboardFormatters): EnhancedStatCardProps[] => [
  {
    title: 'Active Projects',
    value: stats.activeProjects ?? 0,
    icon: FolderOpen,
    color: '#3B82F6',
    trend: trends.activeProjects,
    subtitle: 'Currently in progress',
    description: 'Projects actively being worked on',
    route: '/projects',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Team Members',
    value: stats.teamMembers ?? 0,
    icon: Users,
    color: '#10B981',
    trend: trends.teamMembers,
    subtitle: 'Active staff',
    description: 'Total active team members',
    route: '/staff',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Completed Tasks',
    value: stats.completedTasks ?? 0,
    icon: CheckCircle,
    color: '#059669',
    trend: trends.completedTasks,
    subtitle: 'This month',
    description: 'Successfully completed tasks',
    route: '/tasks',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Open Issues',
    value: stats.openIssues ?? 0,
    icon: AlertTriangle,
    color: '#D97706',
    trend: trends.openIssues,
    subtitle: 'Requires attention',
    description: 'Issues awaiting resolution',
    route: '/action-items',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Poles Installed',
    value: stats.polesInstalled ?? 0,
    icon: MapPin,
    color: '#8B5CF6',
    trend: trends.polesInstalled,
    subtitle: 'Total installed',
    description: 'Infrastructure deployment progress',
    route: '/pole-capture',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Total Revenue',
    value: stats.totalRevenue ?? 0,
    icon: DollarSign,
    color: '#059669',
    trend: trends.totalRevenue,
    subtitle: 'This month',
    description: 'Revenue generated from projects',
    route: '/analytics',
    variant: 'detailed',
    formatValue: formatters.formatCurrency,
  },
];

// 🟢 WORKING: Contractors Dashboard card configurations
export const getContractorsDashboardCards = (stats: DashboardStats, trends: DashboardTrends, formatters: DashboardFormatters): EnhancedStatCardProps[] => [
  {
    title: 'Active Contractors',
    value: stats.contractorsActive ?? 0,
    icon: UserCheck,
    color: '#3B82F6',
    trend: trends.contractorsActive,
    subtitle: 'Currently working',
    description: 'Contractors actively on projects',
    route: '/contractors',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Pending Applications',
    value: stats.contractorsPending ?? 0,
    icon: Clock,
    color: '#D97706',
    trend: trends.contractorsPending,
    subtitle: 'Awaiting approval',
    description: 'New contractor applications',
    route: '/contractors?status=pending',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Performance Score',
    value: stats.performanceScore ?? 0,
    icon: TrendingUp,
    color: '#10B981',
    trend: trends.performanceScore,
    subtitle: 'Average rating',
    description: 'Overall contractor performance',
    route: '/contractors',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'Quality Score',
    value: stats.qualityScore ?? 0,
    icon: Award,
    color: '#8B5CF6',
    trend: trends.qualityScore,
    subtitle: 'Quality metrics',
    description: 'Work quality assessment',
    route: '/contractors',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'On-Time Delivery',
    value: stats.onTimeDelivery ?? 0,
    icon: Calendar,
    color: '#059669',
    trend: trends.onTimeDelivery,
    subtitle: 'Schedule adherence',
    description: 'Projects completed on time',
    route: '/contractors',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'Total Projects',
    value: stats.totalProjects ?? 0,
    icon: FolderOpen,
    color: '#6B7280',
    trend: trends.totalProjects,
    subtitle: 'All assignments',
    description: 'Total project assignments',
    route: '/projects',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
];

// 🟢 WORKING: Procurement Dashboard card configurations
export const getProcurementDashboardCards = (stats: DashboardStats, trends: DashboardTrends, formatters: DashboardFormatters): EnhancedStatCardProps[] => [
  {
    title: 'Active BOQs',
    value: stats.boqsActive ?? 0,
    icon: ClipboardList,
    color: '#3B82F6',
    trend: trends.boqsActive,
    subtitle: 'Bills of Quantities',
    description: 'Currently active BOQs',
    route: '/procurement/boq',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Active RFQs',
    value: stats.rfqsActive ?? 0,
    icon: ShoppingCart,
    color: '#8B5CF6',
    trend: trends.rfqsActive,
    subtitle: 'Request for Quotes',
    description: 'Open procurement requests',
    route: '/procurement/rfq',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Active Suppliers',
    value: stats.supplierActive ?? 0,
    icon: Truck,
    color: '#10B981',
    trend: trends.supplierActive,
    subtitle: 'Verified suppliers',
    description: 'Active supplier partnerships',
    route: '/suppliers',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Budget Utilization',
    value: stats.budgetUtilization ?? 0,
    icon: PieChart,
    color: '#D97706',
    trend: trends.budgetUtilization,
    subtitle: 'Budget consumed',
    description: 'Current budget utilization',
    route: '/procurement',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'Procurement Value',
    value: stats.totalRevenue ?? 0,
    icon: DollarSign,
    color: '#059669',
    trend: trends.totalRevenue,
    subtitle: 'Total value',
    description: 'Value of active procurements',
    route: '/analytics',
    variant: 'detailed',
    formatValue: formatters.formatCurrency,
  },
  {
    title: 'Pending Issues',
    value: stats.openIssues ?? 0,
    icon: AlertTriangle,
    color: '#EF4444',
    trend: trends.openIssues,
    subtitle: 'Requires attention',
    description: 'Procurement issues to resolve',
    route: '/action-items',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
];

// 🟢 WORKING: Analytics Dashboard card configurations (enhanced)
export const getAnalyticsDashboardCards = (stats: DashboardStats, trends: DashboardTrends, formatters: DashboardFormatters): EnhancedStatCardProps[] => [
  {
    title: 'Total Poles',
    value: stats.polesInstalled ?? 0,
    icon: MapPin,
    color: '#3B82F6',
    trend: trends.polesInstalled,
    subtitle: 'Infrastructure deployed',
    description: 'Total poles installed across projects',
    route: '/pole-capture',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Total Drops',
    value: stats.dropsCompleted ?? 0,
    icon: Wifi,
    color: '#8B5CF6',
    trend: trends.dropsCompleted,
    subtitle: 'Connections made',
    description: 'Customer connections completed',
    route: '/drops',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Fiber Installed',
    value: stats.fiberInstalled ?? 0,
    icon: Activity,
    color: '#D97706',
    trend: trends.fiberInstalled,
    subtitle: 'Meters deployed',
    description: 'Total fiber optic cable installed',
    route: '/fiber-stringing',
    variant: 'detailed',
    formatValue: (value: number | string) => `${formatters.formatNumber(value)}m`,
  },
  {
    title: 'Revenue',
    value: stats.totalRevenue ?? 0,
    icon: DollarSign,
    color: '#10B981',
    trend: trends.totalRevenue,
    subtitle: 'Total earnings',
    description: 'Revenue from all projects',
    route: '/analytics',
    variant: 'detailed',
    formatValue: formatters.formatCurrency,
  },
  {
    title: 'Active Teams',
    value: stats.teamMembers ?? 0,
    icon: Users,
    color: '#059669',
    trend: trends.teamMembers,
    subtitle: 'Working teams',
    description: 'Teams currently active',
    route: '/staff',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
];

// 🟢 WORKING: Reports Dashboard card configurations
export const getReportsDashboardCards = (stats: DashboardStats, trends: DashboardTrends, formatters: DashboardFormatters): EnhancedStatCardProps[] => [
  {
    title: 'Reports Generated',
    value: stats.reportsGenerated ?? 0,
    icon: FileText,
    color: '#3B82F6',
    trend: trends.reportsGenerated,
    subtitle: 'This month',
    description: 'Reports created and generated',
    route: '/reports',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Active Projects',
    value: stats.activeProjects ?? 0,
    icon: FolderOpen,
    color: '#8B5CF6',
    trend: trends.activeProjects,
    subtitle: 'Being tracked',
    description: 'Projects included in reports',
    route: '/projects',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Revenue Tracked',
    value: stats.totalRevenue ?? 0,
    icon: DollarSign,
    color: '#10B981',
    trend: trends.totalRevenue,
    subtitle: 'Financial data',
    description: 'Revenue tracked in reports',
    route: '/reports',
    variant: 'detailed',
    formatValue: formatters.formatCurrency,
  },
  {
    title: 'Performance Score',
    value: stats.performanceScore ?? 0,
    icon: TrendingUp,
    color: '#D97706',
    trend: trends.performanceScore,
    subtitle: 'Overall rating',
    description: 'Average performance metrics',
    route: '/reports',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'Data Points',
    value: stats.completedTasks ?? 0,
    icon: Database,
    color: '#6B7280',
    trend: trends.completedTasks,
    subtitle: 'Tracked metrics',
    description: 'Total data points collected',
    route: '/reports',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Team Coverage',
    value: stats.teamMembers ?? 0,
    icon: Shield,
    color: '#059669',
    trend: trends.teamMembers,
    subtitle: 'Members reporting',
    description: 'Team members in reports',
    route: '/reports',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
];

// 🟢 WORKING: KPI Dashboard card configurations
export const getKPIDashboardCards = (stats: DashboardStats, trends: DashboardTrends, formatters: DashboardFormatters): EnhancedStatCardProps[] => [
  {
    title: 'Performance Score',
    value: stats.performanceScore ?? 0,
    icon: BarChart3,
    color: '#3B82F6',
    trend: trends.performanceScore,
    subtitle: 'Overall KPI',
    description: 'Consolidated performance metric',
    route: '/kpi-dashboard',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'Quality Score',
    value: stats.qualityScore ?? 0,
    icon: Target,
    color: '#10B981',
    trend: trends.qualityScore,
    subtitle: 'Quality metrics',
    description: 'Work quality assessment',
    route: '/kpi-dashboard',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'On-Time Delivery',
    value: stats.onTimeDelivery ?? 0,
    icon: Calendar,
    color: '#8B5CF6',
    trend: trends.onTimeDelivery,
    subtitle: 'Schedule adherence',
    description: 'Projects delivered on time',
    route: '/kpi-dashboard',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'Budget Efficiency',
    value: stats.budgetUtilization ?? 0,
    icon: DollarSign,
    color: '#D97706',
    trend: trends.budgetUtilization,
    subtitle: 'Budget utilization',
    description: 'Efficient budget usage',
    route: '/kpi-dashboard',
    variant: 'detailed',
    formatValue: formatters.formatPercentage,
  },
  {
    title: 'Team Productivity',
    value: stats.teamMembers ?? 0,
    icon: Users,
    color: '#059669',
    trend: trends.teamMembers,
    subtitle: 'Active contributors',
    description: 'Productive team members',
    route: '/kpi-dashboard',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
  {
    title: 'Project Success',
    value: stats.activeProjects ?? 0,
    icon: Award,
    color: '#DC2626',
    trend: trends.activeProjects,
    subtitle: 'Success rate',
    description: 'Successfully completed projects',
    route: '/kpi-dashboard',
    variant: 'detailed',
    formatValue: formatters.formatNumber,
  },
];

// 🟢 WORKING: Dashboard type mapping
export const getDashboardCards = (
  dashboardType: 'main' | 'contractors' | 'procurement' | 'analytics' | 'reports' | 'kpi',
  stats: DashboardStats,
  trends: DashboardTrends,
  formatters: DashboardFormatters
): EnhancedStatCardProps[] => {
  switch (dashboardType) {
    case 'main':
      return getMainDashboardCards(stats, trends, formatters);
    case 'contractors':
      return getContractorsDashboardCards(stats, trends, formatters);
    case 'procurement':
      return getProcurementDashboardCards(stats, trends, formatters);
    case 'analytics':
      return getAnalyticsDashboardCards(stats, trends, formatters);
    case 'reports':
      return getReportsDashboardCards(stats, trends, formatters);
    case 'kpi':
      return getKPIDashboardCards(stats, trends, formatters);
    default:
      return getMainDashboardCards(stats, trends, formatters);
  }
};