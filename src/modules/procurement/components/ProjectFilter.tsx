// 🟢 WORKING: Enhanced project filter with search and view mode switching
import React, { useState, useRef, useEffect } from 'react';
import { 
  ChevronDown, 
  Search, 
  Building2, 
  X, 
  Globe, 
  Filter,
  Check
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type { ProcurementViewMode } from '@/types/procurement/portal.types';
import type { Project } from '@/types/project.types';
import { ProjectStatus } from '@/types/project.types';

type ProjectFilterProject = Pick<Project, 'id' | 'name' | 'code' | 'status'> & { lastActivity?: string };

interface ProjectFilterProps {
  selectedProject?: ProjectFilterProject | undefined;
  viewMode: ProcurementViewMode;
  onProjectChange: (project: ProjectFilterProject | undefined) => void;
  onViewModeChange: (mode: ProcurementViewMode) => void;
  disabled?: boolean;
}

export function ProjectFilter({
  selectedProject,
  viewMode,
  onProjectChange,
  onViewModeChange,
  disabled = false
}: ProjectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Mock projects - would be replaced with real data from API
  const allProjects: ProjectFilterProject[] = [
    { 
      id: '1', 
      name: 'Johannesburg Fiber Rollout', 
      code: 'JHB-2024-001', 
      status: ProjectStatus.ACTIVE,
      lastActivity: '2 hours ago'
    },
    { 
      id: '2', 
      name: 'Cape Town Metro Network', 
      code: 'CPT-2024-002', 
      status: ProjectStatus.ACTIVE,
      lastActivity: '4 hours ago'
    },
    { 
      id: '3', 
      name: 'Durban Coastal Installation', 
      code: 'DBN-2024-003', 
      status: ProjectStatus.ACTIVE,
      lastActivity: '1 day ago'
    },
    { 
      id: '4', 
      name: 'Pretoria Business District', 
      code: 'PTA-2024-004', 
      status: ProjectStatus.ON_HOLD,
      lastActivity: '3 days ago'
    },
    { 
      id: '5', 
      name: 'Port Elizabeth Expansion', 
      code: 'PE-2024-005', 
      status: ProjectStatus.COMPLETED,
      lastActivity: '1 week ago'
    },
    { 
      id: '6', 
      name: 'Bloemfontein Network', 
      code: 'BFN-2024-006', 
      status: ProjectStatus.ACTIVE,
      lastActivity: '6 hours ago'
    }
  ];

  // Filter projects based on search and status
  const filteredProjects = allProjects.filter(project => {
    const matchesSearch = 
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.code.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle individual project selection
  const handleProjectSelect = (project: ProjectFilterProject) => {
    onProjectChange(project);
    onViewModeChange('single');
    setIsOpen(false);
    setSearchTerm('');
    setStatusFilter('all');
  };

  // Handle "All Projects" selection
  const handleAllProjectsSelect = () => {
    onProjectChange(undefined);
    onViewModeChange('all');
    setIsOpen(false);
    setSearchTerm('');
    setStatusFilter('all');
  };

  // Handle clearing current selection
  const handleClearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onProjectChange(undefined);
    onViewModeChange('single');
  };

  // Get status badge styles - dark mode compatible
  const getStatusBadgeStyles = (status: ProjectStatus) => {
    const baseStyles = 'px-2 py-0.5 text-xs font-medium rounded-full';

    switch (status) {
      case ProjectStatus.ACTIVE:
        return `${baseStyles} bg-green-500/20 text-green-400`;
      case ProjectStatus.COMPLETED:
        return `${baseStyles} bg-blue-500/20 text-blue-400`;
      case ProjectStatus.ON_HOLD:
        return `${baseStyles} bg-yellow-500/20 text-yellow-400`;
      case ProjectStatus.CANCELLED:
        return `${baseStyles} bg-red-500/20 text-red-400`;
      case ProjectStatus.PLANNING:
        return `${baseStyles} bg-purple-500/20 text-purple-400`;
      default:
        return `${baseStyles} bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]`;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Filter Button */}
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="min-w-[300px] justify-between"
      >
        <div className="flex items-center gap-2 flex-1 text-left">
          {viewMode === 'all' ? (
            <>
              <Globe className="h-4 w-4 text-blue-400" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-blue-400 truncate">
                  All Projects
                </div>
                <div className="text-xs text-blue-400/70">
                  Aggregate view • {allProjects.filter(p => p.status === ProjectStatus.ACTIVE).length} active
                </div>
              </div>
            </>
          ) : selectedProject ? (
            <>
              <Building2 className="h-4 w-4 text-[var(--ff-text-secondary)]" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[var(--ff-text-primary)] truncate">
                  {selectedProject.name}
                </div>
                <div className="text-xs text-[var(--ff-text-secondary)] flex items-center gap-2">
                  <span>{selectedProject.code}</span>
                  <span className={getStatusBadgeStyles(selectedProject.status)}>
                    {selectedProject.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <Filter className="h-4 w-4 text-[var(--ff-text-secondary)]" />
              <span className="text-[var(--ff-text-secondary)]">Select project or view all</span>
            </>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {(selectedProject || viewMode === 'all') && (
            <button
              type="button"
              onClick={handleClearSelection}
              className="p-1 hover:bg-[var(--ff-bg-hover)] rounded"
              disabled={disabled}
              title="Clear selection"
            >
              <X className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </Button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-50">
          {/* Search and Filters */}
          <div className="p-3 border-b border-[var(--ff-border-light)] space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-[var(--ff-text-tertiary)]"
                autoFocus
              />
            </div>

            {/* Status Filter */}
            <div className="flex gap-2 flex-wrap">
              <span className="text-xs text-[var(--ff-text-secondary)] py-1">Status:</span>
              {(['all', ProjectStatus.PLANNING, ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-2 py-1 text-xs font-medium rounded-full transition-colors ${
                    statusFilter === status
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                  }`}
                >
                  {status === 'all' ? 'All' : status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  {statusFilter === status && <Check className="inline h-3 w-3 ml-1" />}
                </button>
              ))}
            </div>
          </div>

          {/* Project List */}
          <div className="max-h-64 overflow-y-auto">
            {/* All Projects Option */}
            {!searchTerm && statusFilter === 'all' && (
              <div className="py-1 border-b border-[var(--ff-border-light)]">
                <button
                  onClick={handleAllProjectsSelect}
                  className={`w-full px-4 py-3 text-left hover:bg-blue-500/10 transition-colors ${
                    viewMode === 'all' ? 'bg-blue-500/10 text-blue-400' : 'text-[var(--ff-text-primary)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-blue-400" />
                    <div className="flex-1">
                      <div className="font-medium">All Projects</div>
                      <div className="text-sm text-[var(--ff-text-secondary)]">
                        Aggregate view across {allProjects.length} projects
                      </div>
                    </div>
                    {viewMode === 'all' && <Check className="h-4 w-4 text-blue-400" />}
                  </div>
                </button>
              </div>
            )}

            {/* Individual Projects */}
            {filteredProjects.length > 0 ? (
              <div className="py-1">
                {filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleProjectSelect(project)}
                    className={`w-full px-4 py-3 text-left hover:bg-[var(--ff-bg-hover)] transition-colors ${
                      selectedProject?.id === project.id && viewMode === 'single'
                        ? 'bg-purple-500/10 text-purple-400'
                        : 'text-[var(--ff-text-primary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-[var(--ff-text-secondary)] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{project.name}</div>
                        <div className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-2">
                          <span>{project.code}</span>
                          <span className={getStatusBadgeStyles(project.status)}>
                            {project.status.replace('_', ' ')}
                          </span>
                          {project.lastActivity && (
                            <span className="text-xs">• {project.lastActivity}</span>
                          )}
                        </div>
                      </div>
                      {selectedProject?.id === project.id && viewMode === 'single' && (
                        <Check className="h-4 w-4 text-purple-400 flex-shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : searchTerm || statusFilter !== 'all' ? (
              <div className="px-4 py-6 text-center text-[var(--ff-text-secondary)] text-sm">
                <Filter className="h-8 w-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
                <p>No projects found</p>
                <p className="text-xs">Try adjusting your filters</p>
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-[var(--ff-text-secondary)] text-sm">
                <Building2 className="h-8 w-8 mx-auto mb-2 text-[var(--ff-text-tertiary)]" />
                <p>No projects available</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
            <div className="flex justify-between items-center text-xs text-[var(--ff-text-secondary)]">
              <span>
                {searchTerm || statusFilter !== 'all'
                  ? `${filteredProjects.length} project${filteredProjects.length !== 1 ? 's' : ''} found`
                  : `${filteredProjects.length} project${filteredProjects.length !== 1 ? 's' : ''} available`
                }
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-purple-400 hover:text-purple-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export for use in other components
export type { ProjectFilterProps };