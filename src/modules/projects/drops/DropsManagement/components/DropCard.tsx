
import { 
  CheckCircle,
  Clock,
  AlertCircle,
  MapPin,
  Calendar,
  User,
  Cable
} from 'lucide-react';
import { cn } from '@/utils/cn';
import type { Drop } from '../types/drops.types';
import { getStatusColor, formatStatusText } from '../utils/dropsUtils';

interface DropCardProps {
  drop: Drop;
  onDropClick: (drop: Drop) => void;
}

export function DropCard({ drop, onDropClick }: DropCardProps) {
  const getStatusIcon = (status: Drop['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4" />;
      case 'in_progress':
      case 'scheduled':
        return <Clock className="h-4 w-4" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div
      className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => onDropClick(drop)}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-[var(--ff-text-primary)]">{drop.dropNumber}</h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">Pole: {drop.poleNumber}</p>
        </div>
        <span className={cn(
          'px-2 py-1 text-xs font-medium rounded-full border flex items-center gap-1',
          getStatusColor(drop.status)
        )}>
          {getStatusIcon(drop.status)}
          {formatStatusText(drop.status)}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-[var(--ff-text-primary)]">{drop.customerName}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-[var(--ff-text-secondary)]">{drop.address}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Cable className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-[var(--ff-text-secondary)]">
            {drop.cableLength}m • {drop.installationType}
          </span>
        </div>

        {drop.scheduledDate && (
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <span className="text-[var(--ff-text-secondary)]">
              {new Date(drop.scheduledDate).toISOString().split('T')[0]}
            </span>
          </div>
        )}

        {drop.technician && (
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <span className="text-[var(--ff-text-secondary)]">{drop.technician}</span>
          </div>
        )}

        {drop.issues && drop.issues.length > 0 && (
          <div className="mt-2 p-2 bg-error-500/20 rounded text-sm text-error-400">
            <AlertCircle className="h-4 w-4 inline mr-1" />
            {drop.issues[0]}
          </div>
        )}
      </div>
    </div>
  );
}