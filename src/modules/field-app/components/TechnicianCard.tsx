import { User, MapPin, Star, CheckCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { FieldTechnician } from '../types/field-app.types';

interface TechnicianCardProps {
  technician: FieldTechnician;
  onSelect: (tech: FieldTechnician) => void;
}

export function TechnicianCard({ technician, onSelect }: TechnicianCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400 bg-green-500/20';
      case 'busy': return 'text-yellow-400 bg-yellow-500/20';
      case 'offline': return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]';
      default: return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]';
    }
  };

  return (
    <div
      className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onSelect(technician)}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[var(--ff-bg-tertiary)] rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </div>
          <div>
            <h3 className="font-medium text-[var(--ff-text-primary)]">{technician.name}</h3>
            <span className={cn(
              "text-xs font-medium px-2 py-1 rounded-full",
              getStatusColor(technician.status)
            )}>
              {technician.status}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <Star className="w-4 h-4 text-yellow-500 fill-current" />
          <span className="text-sm font-medium">{technician.rating}</span>
        </div>
      </div>

      <div className="space-y-2 text-sm text-[var(--ff-text-secondary)]">
        <div className="flex items-center">
          <MapPin className="w-4 h-4 mr-2" />
          <span>
            {technician.location.lat.toFixed(4)}, {technician.location.lng.toFixed(4)}
          </span>
        </div>

        <div className="flex items-center">
          <CheckCircle className="w-4 h-4 mr-2" />
          <span>{technician.completedToday} tasks completed today</span>
        </div>
      </div>

      {technician.currentTask && (
        <div className="mt-3 p-2 bg-blue-500/20 rounded-md">
          <p className="text-xs text-blue-400 font-medium">
            Current Task: {technician.currentTask}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        {technician.expertise.map((skill) => (
          <span
            key={skill}
            className="text-xs bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] px-2 py-1 rounded"
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}