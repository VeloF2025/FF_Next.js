/**
 * Projects Summary Cards Component
 */

import { Activity, Clock, AlertCircle, Calendar } from 'lucide-react';
import { Project, ProjectStatus } from '@/types/project.types';
import { Timestamp } from 'firebase/firestore';

interface ProjectsSummaryCardsProps {
  projects: Project[];
}

/**
 * Helper function to safely convert Date | Timestamp | string to Date
 */
function toDate(dateValue: Date | Timestamp | string): Date {
  if (dateValue instanceof Date) {
    return dateValue;
  }
  if (dateValue && typeof dateValue === 'object' && 'toDate' in dateValue) {
    // It's a Timestamp
    return dateValue.toDate();
  }
  // It's a string
  return new Date(dateValue);
}

export function ProjectsSummaryCards({ projects }: ProjectsSummaryCardsProps) {
  const stats = {
    total: projects.length,
    active: projects.filter(p => p.status === ProjectStatus.ACTIVE).length,
    delayed: projects.filter(p => {
      if (p.status !== ProjectStatus.ACTIVE || !p.endDate) return false;
      const endDate = toDate(p.endDate);
      return endDate < new Date();
    }).length,
    thisMonth: projects.filter(p => {
      if (!p.startDate) return false;
      const startDate = toDate(p.startDate);
      const now = new Date();
      return startDate.getMonth() === now.getMonth() && 
             startDate.getFullYear() === now.getFullYear();
    }).length
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total Projects</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{stats.total}</p>
          </div>
          <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
            <Calendar className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Active Projects</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{stats.active}</p>
          </div>
          <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-lg">
            <Activity className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Delayed</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{stats.delayed}</p>
          </div>
          <div className="p-3 bg-red-100 dark:bg-red-900/20 rounded-lg">
            <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">This Month</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{stats.thisMonth}</p>
          </div>
          <div className="p-3 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
            <Clock className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          </div>
        </div>
      </div>
    </div>
  );
}