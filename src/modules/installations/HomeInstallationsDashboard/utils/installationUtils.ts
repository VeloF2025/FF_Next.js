import { Installation, InstallationStats } from '../types/installation.types';

export const getStatusColor = (status: Installation['status']): string => {
  switch (status) {
    case 'completed': 
      return 'bg-green-100 text-green-800';
    case 'in_progress': 
      return 'bg-blue-100 text-blue-800';
    case 'scheduled': 
      return 'bg-secondary text-foreground';
    case 'issue': 
      return 'bg-red-100 text-red-800';
    case 'cancelled': 
      return 'bg-orange-100 text-orange-800';
    default: 
      return 'bg-secondary text-foreground';
  }
};

export const getSpeedQuality = (speed: number): string => {
  if (speed >= 900) return 'text-green-600';
  if (speed >= 500) return 'text-yellow-600';
  return 'text-red-600';
};

export const calculateInstallationStats = (installations: Installation[]): InstallationStats => {
  return {
    total: installations.length,
    completed: installations.filter(i => i.status === 'completed').length,
    inProgress: installations.filter(i => i.status === 'in_progress').length,
    scheduled: installations.filter(i => i.status === 'scheduled').length,
    issues: installations.filter(i => i.issues.length > 0).length,
    avgSpeed: installations
      .filter(i => i.speedTest.download > 0)
      .reduce((sum, i) => sum + i.speedTest.download, 0) / 
      (installations.filter(i => i.speedTest.download > 0).length || 1)
  };
};