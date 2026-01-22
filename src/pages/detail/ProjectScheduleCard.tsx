/**
 * Project Schedule Card Component
 */

import { Calendar, Clock, DollarSign, Users } from 'lucide-react';
import { Project } from '@/types/project.types';
import { Timestamp } from 'firebase/firestore';

interface ProjectScheduleCardProps {
  project: Project;
}

function toDate(date: Date | Timestamp | string | undefined): Date | null {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (typeof date === 'string') return new Date(date);
  if (date && typeof date === 'object' && 'toDate' in date) {
    return (date as Timestamp).toDate();
  }
  return null;
}

export function ProjectScheduleCard({ project }: ProjectScheduleCardProps) {
  const startDate = toDate(project.startDate);
  const endDate = toDate(project.endDate);
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule & Resources</h2>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center text-gray-600">
            <Calendar className="h-4 w-4 mr-2" />
            <span className="text-sm">Start Date</span>
          </div>
          <span className="text-sm font-medium text-gray-900">
            {startDate ? startDate.toISOString().split('T')[0] : 'Not set'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center text-gray-600">
            <Calendar className="h-4 w-4 mr-2" />
            <span className="text-sm">End Date</span>
          </div>
          <span className="text-sm font-medium text-gray-900">
            {endDate ? endDate.toISOString().split('T')[0] : 'Not set'}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center text-gray-600">
            <Clock className="h-4 w-4 mr-2" />
            <span className="text-sm">Duration</span>
          </div>
          <span className="text-sm font-medium text-gray-900">
            {startDate && endDate
              ? `${Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days`
              : 'Not set'}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center text-gray-600">
            <DollarSign className="h-4 w-4 mr-2" />
            <span className="text-sm">Budget</span>
          </div>
          <span className="text-sm font-medium text-gray-900">
            {project.budget ? `R ${project.budget.toLocaleString()}` : 'Not set'}
          </span>
        </div>
        
        {project.projectManager && (
          <div className="flex items-center justify-between">
            <div className="flex items-center text-gray-600">
              <Users className="h-4 w-4 mr-2" />
              <span className="text-sm">Project Manager</span>
            </div>
            <span className="text-sm font-medium text-gray-900">
              {project.projectManager}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}