import { cn } from '@/utils/cn';
import { SOWFilterType } from '../types/sow.types';

interface SOWFiltersProps {
  filter: SOWFilterType;
  onFilterChange: (filter: SOWFilterType) => void;
}

export function SOWFilters({ filter, onFilterChange }: SOWFiltersProps) {
  const filters = [
    { key: 'all', label: 'All SOWs' },
    { key: 'draft', label: 'Draft' },
    { key: 'pending_approval', label: 'Pending Approval' },
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' }
  ] as const;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-1">
      <div className="flex space-x-1">
        {filters.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onFilterChange(key)}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              filter === key
                ? 'bg-primary-500/20 text-primary-400'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}