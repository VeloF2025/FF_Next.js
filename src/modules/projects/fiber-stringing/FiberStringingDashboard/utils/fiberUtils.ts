import { FiberSection, FiberStats } from '../types/fiberStringing.types';

export const calculateStats = (sectionData: FiberSection[]): FiberStats => {
  const total = sectionData.length;
  const completed = sectionData.filter(s => s.status === 'completed').length;
  const inProgress = sectionData.filter(s => s.status === 'in_progress').length;
  const withIssues = sectionData.filter(s => s.status === 'issues').length;
  
  const totalDist = sectionData.reduce((sum, s) => sum + s.distance, 0);
  const completedDist = sectionData
    .filter(s => s.status === 'completed')
    .reduce((sum, s) => sum + s.distance, 0);
  
  // Calculate average speed based on completed sections
  const completedWithDates = sectionData.filter(
    s => s.status === 'completed' && s.startDate && s.completionDate
  );
  
  let avgSpeed = 0;
  if (completedWithDates.length > 0) {
    const totalDays = completedWithDates.reduce((sum, s) => {
      const start = new Date(s.startDate!);
      const end = new Date(s.completionDate!);
      const days = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return sum + days;
    }, 0);
    avgSpeed = completedDist / totalDays;
  }

  // Estimate completion
  const remainingDist = totalDist - completedDist;
  const daysToComplete = avgSpeed > 0 ? Math.ceil(remainingDist / avgSpeed) : 0;
  const estimatedDate = new Date();
  estimatedDate.setDate(estimatedDate.getDate() + daysToComplete);

  return {
    totalDistance: totalDist,
    completedDistance: completedDist,
    sectionsTotal: total,
    sectionsCompleted: completed,
    sectionsInProgress: inProgress,
    sectionsWithIssues: withIssues,
    averageSpeed: avgSpeed,
    estimatedCompletion: estimatedDate.toISOString().split('T')[0] ?? '',
  };
};

export const getStatusColor = (status: FiberSection['status']): string => {
  switch (status) {
    case 'completed':
      return 'bg-success-100 text-success-800 border-success-200';
    case 'in_progress':
      return 'bg-info-100 text-info-800 border-info-200';
    case 'issues':
      return 'bg-error-100 text-error-800 border-error-200';
    default:
      return 'bg-neutral-100 text-neutral-800 border-neutral-200';
  }
};