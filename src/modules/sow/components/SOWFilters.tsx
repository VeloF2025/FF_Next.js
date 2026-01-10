import { Search } from 'lucide-react';
import { SOWDocumentType, DocumentStatus } from '@/modules/projects/types/project.types';

interface SOWFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
}

export function SOWFilters({
  searchTerm,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange
}: SOWFiltersProps) {
  return (
    <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="relative">
        <input
          type="text"
          placeholder="Search documents..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full px-4 py-2 pl-10 pr-4 text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:border-blue-500"
        />
        <Search className="absolute left-3 top-2.5 h-5 w-5 text-[var(--ff-text-tertiary)]" />
      </div>

      <select
        value={typeFilter}
        onChange={(e) => onTypeFilterChange(e.target.value)}
        className="px-4 py-2 text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:border-blue-500"
      >
        <option value="all">All Types</option>
        <option value={SOWDocumentType.POLES}>Poles</option>
        <option value={SOWDocumentType.DROPS}>Drops</option>
        <option value={SOWDocumentType.CABLE}>Cable</option>
        <option value={SOWDocumentType.TRENCH}>Trench</option>
        <option value={SOWDocumentType.OTHER}>Other</option>
      </select>

      <select
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
        className="px-4 py-2 text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:border-blue-500"
      >
        <option value="all">All Status</option>
        <option value={DocumentStatus.PENDING}>Pending</option>
        <option value={DocumentStatus.APPROVED}>Approved</option>
        <option value={DocumentStatus.REJECTED}>Rejected</option>
      </select>
    </div>
  );
}