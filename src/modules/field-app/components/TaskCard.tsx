import { 
  Clock, Wrench, CheckCircle, MapPin, 
  AlertTriangle, ChevronRight, Paperclip 
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { FieldTask } from '../types/field-app.types';

interface TaskCardProps {
  task: FieldTask;
  onSelect: (task: FieldTask) => void;
}

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400 bg-green-500/20';
      case 'in_progress': return 'text-blue-400 bg-blue-500/20';
      case 'pending': return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]';
      case 'failed': return 'text-red-400 bg-red-500/20';
      default: return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)]';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'text-red-400';
      case 'high': return 'text-orange-400';
      case 'medium': return 'text-yellow-400';
      case 'low': return 'text-green-400';
      default: return 'text-[var(--ff-text-secondary)]';
    }
  };

  const getTaskIcon = (type: string) => {
    switch (type) {
      case 'installation': return <Wrench className="w-4 h-4" />;
      case 'maintenance': return <Clock className="w-4 h-4" />;
      case 'inspection': return <CheckCircle className="w-4 h-4" />;
      case 'repair': return <AlertTriangle className="w-4 h-4" />;
      default: return <Wrench className="w-4 h-4" />;
    }
  };

  return (
    // WCAG: Changed from <div onClick> to <button> for keyboard accessibility (4.1.2)
    <button
      type="button"
      aria-label={`Task: ${task.title} — ${task.status.replace('_', ' ')}, ${task.priority} priority`}
      className={cn(
        "w-full text-left bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] transition-shadow",
        task.offline && "border-orange-300 bg-orange-500/10"
      )}
      onClick={() => onSelect(task)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span aria-hidden="true">{getTaskIcon(task.type)}</span>
          <span className={cn("text-xs font-medium px-2 py-1 rounded-full", getStatusColor(task.status))}>
            {task.status.replace('_', ' ')}
          </span>
        </div>
        <ChevronRight className="w-5 h-5 text-[var(--ff-text-tertiary)]" aria-hidden="true" />
      </div>

      <h3 className="font-medium text-[var(--ff-text-primary)] mb-1">{task.title}</h3>
      <p className="text-sm text-[var(--ff-text-secondary)] mb-2">{task.customer}</p>

      <div className="flex items-center text-xs text-[var(--ff-text-tertiary)] mb-2">
        <MapPin className="w-3 h-3 mr-1" aria-hidden="true" />
        {task.address}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--ff-text-tertiary)]">
          {task.scheduledTime} ({task.estimatedDuration})
        </span>
        <div className="flex items-center space-x-2">
          {task.attachments > 0 && (
            <div className="flex items-center text-[var(--ff-text-tertiary)]" aria-label={`${task.attachments} attachment${task.attachments !== 1 ? 's' : ''}`}>
              <Paperclip className="w-3 h-3 mr-1" aria-hidden="true" />
              {task.attachments}
            </div>
          )}
          <span className={cn("font-medium", getPriorityColor(task.priority))}>
            {task.priority}
          </span>
        </div>
      </div>

      {task.offline && (
        <div className="mt-2 text-xs text-orange-400 font-medium" role="status">
          Offline Mode
        </div>
      )}
    </button>
  );
}