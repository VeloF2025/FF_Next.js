/**
 * Project Detail Helper Functions and Constants
 */

import { ProjectStatus, Priority, PhaseStatus } from '@/types/project.types';
import { CheckCircle, PlayCircle, AlertCircle, Circle } from 'lucide-react';

export const statusColors = {
  [ProjectStatus.PLANNING]: 'bg-purple-500/20 text-purple-400',
  [ProjectStatus.ACTIVE]: 'bg-green-500/20 text-green-400',
  [ProjectStatus.ON_HOLD]: 'bg-yellow-500/20 text-yellow-400',
  [ProjectStatus.COMPLETED]: 'bg-blue-500/20 text-blue-400',
  [ProjectStatus.CANCELLED]: 'bg-red-500/20 text-red-400',
};

export const priorityColors = {
  [Priority.LOW]: 'bg-gray-500/20 text-gray-400',
  [Priority.MEDIUM]: 'bg-yellow-500/20 text-yellow-400',
  [Priority.HIGH]: 'bg-orange-500/20 text-orange-400',
  [Priority.CRITICAL]: 'bg-red-500/20 text-red-400',
};

export const getPhaseStatusIcon = (status: PhaseStatus) => {
  switch (status) {
    case PhaseStatus.COMPLETED:
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    case PhaseStatus.IN_PROGRESS:
      return <PlayCircle className="h-5 w-5 text-blue-600" />;
    case PhaseStatus.ON_HOLD:
      return <AlertCircle className="h-5 w-5 text-red-600" />;
    default:
      return <Circle className="h-5 w-5 text-gray-400" />;
  }
};