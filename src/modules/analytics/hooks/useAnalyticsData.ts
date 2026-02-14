import { useState, useEffect } from 'react';
import { 
  DailyProgress, 
  ProjectMetrics, 
  TeamPerformance,
  AnalyticsStats,
  TimeRange
} from '../types/analytics.types';

export function useAnalyticsData(timeRange: TimeRange) {
  const [dailyProgress, setDailyProgress] = useState<DailyProgress[]>([]);
  const [projectMetrics, setProjectMetrics] = useState<ProjectMetrics[]>([]);
  const [teamPerformance, setTeamPerformance] = useState<TeamPerformance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadAnalyticsData();
  }, [timeRange]);

  const loadAnalyticsData = () => {
    setIsLoading(true);
    
    // Mock data - will be replaced with actual API calls
    const mockDailyProgress: DailyProgress[] = [
      { date: 'Mon', polesInstalled: 45, dropsCompleted: 120, fiberMeters: 2500, tasksCompleted: 28, revenue: 15000 },
      { date: 'Tue', polesInstalled: 52, dropsCompleted: 135, fiberMeters: 2800, tasksCompleted: 32, revenue: 17500 },
      { date: 'Wed', polesInstalled: 38, dropsCompleted: 98, fiberMeters: 2100, tasksCompleted: 25, revenue: 13000 },
      { date: 'Thu', polesInstalled: 61, dropsCompleted: 158, fiberMeters: 3200, tasksCompleted: 38, revenue: 21000 },
      { date: 'Fri', polesInstalled: 55, dropsCompleted: 142, fiberMeters: 2900, tasksCompleted: 35, revenue: 19000 },
      { date: 'Sat', polesInstalled: 42, dropsCompleted: 110, fiberMeters: 2300, tasksCompleted: 26, revenue: 14500 },
      { date: 'Sun', polesInstalled: 28, dropsCompleted: 72, fiberMeters: 1500, tasksCompleted: 18, revenue: 9500 }
    ];

    const mockProjectMetrics: ProjectMetrics[] = [
      {
        projectName: 'Stellenbosch Phase 1',
        completion: 78,
        polesCompleted: 3900,
        totalPoles: 5000,
        dropsCompleted: 15600,
        totalDrops: 20000,
        status: 'on-track',
        trend: 'up'
      },
      {
        projectName: 'Paarl Expansion',
        completion: 45,
        polesCompleted: 2250,
        totalPoles: 5000,
        dropsCompleted: 9000,
        totalDrops: 20000,
        status: 'delayed',
        trend: 'down'
      },
      {
        projectName: 'Wellington Connect',
        completion: 92,
        polesCompleted: 4600,
        totalPoles: 5000,
        dropsCompleted: 18400,
        totalDrops: 20000,
        status: 'ahead',
        trend: 'up'
      }
    ];

    const mockTeamPerformance: TeamPerformance[] = [
      { teamName: 'Alpha Team', productivity: 95, tasksCompleted: 156, avgCompletionTime: 2.3, qualityScore: 98 },
      { teamName: 'Bravo Team', productivity: 88, tasksCompleted: 142, avgCompletionTime: 2.8, qualityScore: 92 },
      { teamName: 'Charlie Team', productivity: 92, tasksCompleted: 149, avgCompletionTime: 2.5, qualityScore: 95 },
      { teamName: 'Delta Team', productivity: 79, tasksCompleted: 128, avgCompletionTime: 3.2, qualityScore: 88 }
    ];

    setTimeout(() => {
      setDailyProgress(mockDailyProgress);
      setProjectMetrics(mockProjectMetrics);
      setTeamPerformance(mockTeamPerformance);
      setIsLoading(false);
    }, 1000);
  };

  const calculateStats = (): AnalyticsStats => {
    const totalPoles = dailyProgress.reduce((sum, day) => sum + day.polesInstalled, 0);
    const totalDrops = dailyProgress.reduce((sum, day) => sum + day.dropsCompleted, 0);
    const totalFiber = dailyProgress.reduce((sum, day) => sum + day.fiberMeters, 0);
    const totalRevenue = dailyProgress.reduce((sum, day) => sum + day.revenue, 0);
    const activeTeams = teamPerformance.length;

    return {
      totalPoles,
      totalDrops,
      totalFiber,
      totalRevenue,
      activeTeams
    };
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat('en-ZA').format(num);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'on-track': return 'text-green-600';
      case 'delayed': return 'text-red-600';
      case 'ahead': return 'text-blue-600';
      default: return 'text-muted-foreground';
    }
  };

  const getTrendIcon = (trend: string): string => {
    switch (trend) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return '→';
    }
  };

  return {
    dailyProgress,
    projectMetrics,
    teamPerformance,
    isLoading,
    stats: calculateStats(),
    loadAnalyticsData,
    formatNumber,
    getStatusColor,
    getTrendIcon
  };
}