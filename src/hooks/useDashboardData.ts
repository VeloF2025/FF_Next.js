/**
 * Dashboard Data Hook - Centralized data management for all dashboards
 * Provides consistent data loading, error handling, and loading states
 * ZERO MOCK DATA - All statistics from real database sources
 */

import { useState, useEffect, useCallback } from 'react';
import { DashboardStatsService } from '@/services/dashboard/dashboardStatsService';
import type { DashboardStats } from '@/services/dashboard/dashboardStatsService';
import { log } from '@/lib/logger';

// 🟢 WORKING: Re-export dashboard stats interface from service
export type { DashboardStats } from '@/services/dashboard/dashboardStatsService';

export interface DashboardMetrics {
  stats: DashboardStats;
  trends: Record<string, {
    value: number;
    direction: 'up' | 'down' | 'stable';
    percentage: number;
  }>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

// 🟢 WORKING: Main dashboard data hook
export function useDashboardData() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    stats: {
      totalProjects: 0,
      activeProjects: 0,
      completedProjects: 0,
      completedTasks: 0,
      teamMembers: 0,
      openIssues: 0,
      polesInstalled: 0,
      dropsCompleted: 0,
      fiberInstalled: 0,
      totalRevenue: 0,
      contractorsActive: 0,
      contractorsPending: 0,
      boqsActive: 0,
      rfqsActive: 0,
      supplierActive: 0,
      reportsGenerated: 0,
      performanceScore: 0,
      qualityScore: 0,
      onTimeDelivery: 0,
      budgetUtilization: 0,
    },
    trends: {},
    isLoading: true,
    error: null,
    lastUpdated: null,
  });

  // 🟢 WORKING: Load dashboard data with error handling
  const loadDashboardData = useCallback(async () => {
    try {
      setMetrics(prev => ({ ...prev, isLoading: true, error: null }));

      // 🟢 WORKING: Get real statistics from database sources - ZERO MOCK DATA
      const [stats, trends] = await Promise.all([
        DashboardStatsService.getDashboardStats(),
        DashboardStatsService.getDashboardTrends()
      ]);

      setMetrics({
        stats,
        trends,
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (error) {
      log.error('Failed to load dashboard data:', { data: error }, 'useDashboardData');
      setMetrics(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load dashboard data',
      }));
    }
  }, []);

  // 🟢 WORKING: Initialize data on mount
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // 🟢 WORKING: Utility functions
  const formatNumber = useCallback((num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }, []);

  const formatCurrency = useCallback((amount: number): string => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }, []);

  const formatPercentage = useCallback((value: number): string => {
    return `${value.toFixed(1)}%`;
  }, []);

  const getTrendColor = useCallback((direction: 'up' | 'down' | 'stable'): string => {
    switch (direction) {
      case 'up': return 'text-green-600';
      case 'down': return 'text-red-600';
      case 'stable': return 'text-muted-foreground';
      default: return 'text-muted-foreground';
    }
  }, []);

  const getTrendIcon = useCallback((direction: 'up' | 'down' | 'stable'): string => {
    switch (direction) {
      case 'up': return '↗';
      case 'down': return '↘';
      case 'stable': return '→';
      default: return '→';
    }
  }, []);

  return {
    ...metrics,
    loadDashboardData,
    formatNumber,
    formatCurrency,
    formatPercentage,
    getTrendColor,
    getTrendIcon,
  };
}

// 🟢 WORKING: Specialized hooks for different dashboard types
export function useMainDashboardData() {
  const dashboardData = useDashboardData();

  const mainDashboardStats = {
    activeProjects: dashboardData.stats.activeProjects,
    teamMembers: dashboardData.stats.teamMembers,
    completedTasks: dashboardData.stats.completedTasks,
    openIssues: dashboardData.stats.openIssues,
    polesInstalled: dashboardData.stats.polesInstalled,
    totalRevenue: dashboardData.stats.totalRevenue,
    // 🟢 WORKING: Include performance metrics for KPI display
    qualityScore: dashboardData.stats.qualityScore,
    onTimeDelivery: dashboardData.stats.onTimeDelivery,
    performanceScore: dashboardData.stats.performanceScore,
  };

  return {
    ...dashboardData,
    stats: mainDashboardStats,
  };
}

export function useContractorsDashboardData() {
  const dashboardData = useDashboardData();

  const contractorStats = {
    contractorsActive: dashboardData.stats.contractorsActive,
    contractorsPending: dashboardData.stats.contractorsPending,
    totalProjects: dashboardData.stats.totalProjects,
    performanceScore: dashboardData.stats.performanceScore,
    qualityScore: dashboardData.stats.qualityScore,
    onTimeDelivery: dashboardData.stats.onTimeDelivery,
  };

  return {
    ...dashboardData,
    stats: contractorStats,
  };
}

export function useProcurementDashboardData() {
  const dashboardData = useDashboardData();

  const procurementStats = {
    boqsActive: dashboardData.stats.boqsActive,
    rfqsActive: dashboardData.stats.rfqsActive,
    supplierActive: dashboardData.stats.supplierActive,
    budgetUtilization: dashboardData.stats.budgetUtilization,
    totalRevenue: dashboardData.stats.totalRevenue,
    openIssues: dashboardData.stats.openIssues,
  };

  return {
    ...dashboardData,
    stats: procurementStats,
  };
}

export function useKPIDashboardData() {
  const dashboardData = useDashboardData();

  const kpiStats = {
    performanceScore: dashboardData.stats.performanceScore,
    qualityScore: dashboardData.stats.qualityScore,
    onTimeDelivery: dashboardData.stats.onTimeDelivery,
    budgetUtilization: dashboardData.stats.budgetUtilization,
    teamMembers: dashboardData.stats.teamMembers,
    activeProjects: dashboardData.stats.activeProjects,
  };

  return {
    ...dashboardData,
    stats: kpiStats,
  };
}

export function useReportsDashboardData() {
  const dashboardData = useDashboardData();

  const reportsStats = {
    reportsGenerated: dashboardData.stats.reportsGenerated,
    activeProjects: dashboardData.stats.activeProjects,
    totalRevenue: dashboardData.stats.totalRevenue,
    performanceScore: dashboardData.stats.performanceScore,
    completedTasks: dashboardData.stats.completedTasks,
    teamMembers: dashboardData.stats.teamMembers,
  };

  return {
    ...dashboardData,
    stats: reportsStats,
  };
}