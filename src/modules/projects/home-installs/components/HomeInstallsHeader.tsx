import { Plus, Download, Search } from 'lucide-react';

interface HomeInstallsHeaderProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  dateFilter: string;
  onDateFilterChange: (value: string) => void;
  onAddNew: () => void;
  onExport: () => void;
}

export function HomeInstallsHeader({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  dateFilter,
  onDateFilterChange,
  onAddNew,
  onExport,
}: HomeInstallsHeaderProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 mb-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Home Installations</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Manage fiber installations for residential customers</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onExport}
            className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            onClick={onAddNew}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Installation
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search by customer name, address, or order number..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
        >
          <option value="all">All Status</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="pending">Pending</option>
        </select>

        <select
          value={dateFilter}
          onChange={(e) => onDateFilterChange(e.target.value)}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
        >
          <option value="all">All Dates</option>
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="this_week">This Week</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>
    </div>
  );
}