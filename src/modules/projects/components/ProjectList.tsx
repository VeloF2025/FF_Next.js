import { useState } from 'react';
import { Search, Filter, Download } from 'lucide-react';
import { useNeonProjects } from '@/hooks/neon/useNeonProjects';
import { projectsService } from '@/services/projectsService';
import { notificationService } from '@/services/core/NotificationService';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ProjectSummaryCards } from './ProjectSummaryCards';
import { ProjectTable } from './ProjectTable';

export function ProjectList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [selectedPriority, setSelectedPriority] = useState<string[]>([]);

  const { projects, loading: isLoading, error, refetch } = useNeonProjects();
  
  // Filter projects based on search and filters
  const filteredProjects = projects.filter((project: any) => {
    const matchesSearch = !searchTerm || 
      project.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.client_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.city?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = selectedStatus.length === 0 ||
      selectedStatus.some(s => s.toLowerCase() === (project.status || '').toLowerCase());

    const matchesPriority = selectedPriority.length === 0 ||
      selectedPriority.some(p => p.toLowerCase() === (project.priority || '').toLowerCase());
    
    return matchesSearch && matchesStatus && matchesPriority;
  });

  // Search filters instantly as you type - no form submit needed
  // Form wrapper kept for accessibility (Enter key support)

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await projectsService.delete(id);
      refetch();
      notificationService.success('Project deleted successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete project';
      notificationService.error(message);
    }
  };

  const handleExport = async () => {
    try {
      // Export filtered projects to CSV
      const csvContent = filteredProjects.map((project: any) => ({
        'Name': project.name || '',
        'Client': project.client_name || '',
        'Status': project.status || '',
        'Priority': project.priority || '',
        'City': project.city || '',
        'Province': project.province || '',
        'Total Drops': project.total_drops || 0,
        'Completed Drops': project.completed_drops || 0,
        'Start Date': project.start_date || '',
        'End Date': project.end_date || '',
      }));

      if (csvContent.length === 0) {
        notificationService.info('No projects to export');
        return;
      }

      const firstRow = csvContent[0];
      const csv = [
        Object.keys(firstRow).join(','),
        ...csvContent.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Build descriptive filename with active filters
      const filterParts: string[] = [];
      if (selectedStatus.length > 0) filterParts.push(selectedStatus.join('-'));
      if (selectedPriority.length > 0) filterParts.push(selectedPriority.join('-'));
      if (searchTerm) filterParts.push('search');
      const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
      a.download = `projects${filterSuffix}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notificationService.success(`Exported ${filteredProjects.length} projects`);
    } catch (error) {
      notificationService.error('Failed to export projects');
    }
  };

  const statuses = ['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
  const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

  return (
    <div className="space-y-6">
      <ProjectSummaryCards projects={projects} />

      {/* Search and Filters */}
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center gap-4">
          <form onSubmit={(e) => e.preventDefault()} className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-tertiary)] h-4 w-4" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
              />
            </div>
          </form>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
              showFilters || selectedStatus.length > 0 || selectedPriority.length > 0
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {(selectedStatus.length > 0 || selectedPriority.length > 0) && (
              <span className="bg-blue-600 text-white text-xs rounded-full px-2 py-0.5">
                {selectedStatus.length + selectedPriority.length}
              </span>
            )}
          </button>

          {filteredProjects.length > 0 && (
            <button
              onClick={handleExport}
              title={`Export ${selectedStatus.length > 0 || selectedPriority.length > 0 || searchTerm ? 'filtered' : 'all'} projects to CSV`}
              className="flex items-center gap-2 px-4 py-2 text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          )}
        </div>

        {/* Filter Options */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Status</h4>
                <div className="space-y-2">
                  {statuses.map((status) => (
                    <label key={status} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedStatus.includes(status)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedStatus([...selectedStatus, status]);
                          } else {
                            setSelectedStatus(selectedStatus.filter(s => s !== status));
                          }
                        }}
                        className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-[var(--ff-text-primary)]">
                        {status.replace('_', ' ')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Priority</h4>
                <div className="space-y-2">
                  {priorities.map((priority) => (
                    <label key={priority} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedPriority.includes(priority)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPriority([...selectedPriority, priority]);
                          } else {
                            setSelectedPriority(selectedPriority.filter(p => p !== priority));
                          }
                        }}
                        className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-[var(--ff-text-primary)] capitalize">
                        {priority.toLowerCase()}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {(selectedStatus.length > 0 || selectedPriority.length > 0) && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => {
                    setSelectedStatus([]);
                    setSelectedPriority([]);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <ProjectTable
        projects={filteredProjects}
        isLoading={isLoading}
        error={error ? new Error(error) : null}
        onDelete={handleDelete}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete Project"
        message="Are you sure you want to delete this project? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}