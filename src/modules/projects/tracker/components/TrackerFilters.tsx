import { Search } from 'lucide-react';

interface TrackerFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  selectedType: 'all' | 'pole' | 'drop' | 'fiber';
  setSelectedType: (value: 'all' | 'pole' | 'drop' | 'fiber') => void;
  selectedPhase: string;
  setSelectedPhase: (value: string) => void;
  selectedStatus: string;
  setSelectedStatus: (value: string) => void;
  sortBy: string;
  sortOrder: string;
  setSortBy: (value: any) => void;
  setSortOrder: (value: any) => void;
  phases: string[];
}

export function TrackerFilters({
  searchTerm,
  setSearchTerm,
  selectedType,
  setSelectedType,
  selectedPhase,
  setSelectedPhase,
  selectedStatus,
  setSelectedStatus,
  sortBy,
  sortOrder,
  setSortBy,
  setSortOrder,
  phases
}: TrackerFiltersProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)] space-y-4">
      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-tertiary)] w-4 h-4" />
            <input
              type="text"
              placeholder="Search by ID or location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            />
          </div>
        </div>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as any)}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
        >
          <option value="all">All Types</option>
          <option value="pole">Poles</option>
          <option value="drop">Home Drops</option>
          <option value="fiber">Fiber Sections</option>
        </select>
        <select
          value={selectedPhase}
          onChange={(e) => setSelectedPhase(e.target.value)}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
        >
          <option value="all">All Phases</option>
          {phases.map(phase => (
            <option key={phase} value={phase}>{phase}</option>
          ))}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="issue">Issue</option>
        </select>
        <select
          value={`${sortBy}-${sortOrder}`}
          onChange={(e) => {
            const [field, order] = e.target.value.split('-');
            setSortBy(field);
            setSortOrder(order);
          }}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
        >
          <option value="identifier-asc">ID (A-Z)</option>
          <option value="identifier-desc">ID (Z-A)</option>
          <option value="status-asc">Status (A-Z)</option>
          <option value="status-desc">Status (Z-A)</option>
          <option value="progress-asc">Progress (Low-High)</option>
          <option value="progress-desc">Progress (High-Low)</option>
          <option value="updated-desc">Recently Updated</option>
          <option value="updated-asc">Oldest Updated</option>
        </select>
      </div>
    </div>
  );
}