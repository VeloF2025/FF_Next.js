/**
 * Project Analytics Operations (Neon)
 */

import { analyticsService } from '@/services/analytics/analyticsService';

/**
 * Get project analytics and trends
 */
export async function getProjectAnalytics(projectId?: string) {
  return await analyticsService.getProjectOverview(projectId);
}

/**
 * Get project trends over time
 */
export async function getProjectTrends(dateFrom: Date, dateTo: Date) {
  return await analyticsService.getProjectTrends(dateFrom, dateTo);
}

/**
 * Record KPI metric
 */
export async function recordKPI(
  _projectId: string, 
  _metricType: string, 
  _metricName: string, 
  _value: number, 
  _unit: string = ''
): Promise<void> {
  // TODO: Implement KPI recording when analyticsService.recordKPI is ready
  // const kpiData = {
  //   projectId,
  //   metricType,
  //   metricName,
  //   metricValue: value.toString(),
  //   unit,
  //   recordedDate: new Date(),
  //   weekNumber: getWeekNumber(new Date()),
  //   monthNumber: new Date().getMonth() + 1,
  //   year: new Date().getFullYear(),
  // };
  // await analyticsService.recordKPI(kpiData);
}

/**
 * Sync project data to analytics database
 */
export async function syncProjectToAnalytics(_projectId: string, _projectData: any): Promise<void> {
  try {
    // const _analyticsData: NewProjectAnalytics = {
    //   projectId,
    //   projectName: projectData.name || 'Untitled Project',
    //   clientId: projectData.clientId,
    //   clientName: projectData.clientName,
    //   totalBudget: projectData.budget?.toString(),
    //   spentBudget: '0', // Would be calculated from transactions
    //   startDate: projectData.startDate?.toDate ? projectData.startDate.toDate() : new Date(),
    //   endDate: projectData.endDate?.toDate ? projectData.endDate.toDate() : null,
    //   completionPercentage: (projectData.progress || 0).toString(),
    //   onTimeDelivery: false, // Would be calculated based on dates
    //   qualityScore: (projectData.qualityScore || 0).toString(),
    // };

    // This would insert/update the analytics record
    // TODO: Implement actual analytics sync
    
  } catch (error) {
    // intentional: analytics sync failures must not break main operations
  }
}

/**
 * Get week number of year
 */
// function getWeekNumber(date: Date): number {
//   const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
//   const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
//   return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
// }