import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Building2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { ProjectQueryService } from '@/services/projects/core/projectQueryService';
import type { Project } from '@/types/project.types';
import { log } from '@/lib/logger';

interface SOWProjectSelectorProps {
  onProjectSelect: (project: Project) => void;
  className?: string;
}

export function SOWProjectSelector({ onProjectSelect, className = '' }: SOWProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load projects from database
  const loadProjects = async () => {
    setIsLoadingProjects(true);
    setLoadError(null);
    try {
      const projects = await ProjectQueryService.getActiveProjects();
      setAllProjects(projects);
    } catch (error) {
      log.error('Error loading projects:', { data: error }, 'SOWProjectSelector');
      setAllProjects([]);
      setLoadError('Failed to load projects. Please try again.');
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  // Filter projects based on search
  const filteredProjects = allProjects.filter(project => {
    if (!project || !project.name || !project.code) return false;
    return project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           project.code.toLowerCase().includes(searchTerm.toLowerCase());
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

  const handleProjectSelect = (project: Project) => {
    // Validate project before selection
    if (!project?.id || !project?.name) {
      log.warn('Invalid project data', { project }, 'SOWProjectSelector');
      return;
    }

    setSelectedProject(project);
    onProjectSelect(project);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <Button
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="min-w-[320px] justify-between"
      >
        <div className="flex items-center gap-2 flex-1 text-left">
          {selectedProject ? (
            <>
              <Building2 className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[var(--ff-text-primary)] truncate">
                  {selectedProject.name}
                </div>
                <div className="text-xs text-[var(--ff-text-secondary)]">
                  {selectedProject.code}
                </div>
              </div>
            </>
          ) : (
            <>
              <Building2 className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <span className="text-[var(--ff-text-tertiary)]">Select a project</span>
            </>
          )}
        </div>
        
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-50">
          <div className="p-3 border-b border-[var(--ff-border-light)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {isLoadingProjects ? (
              <div className="px-4 py-6 text-center text-[var(--ff-text-secondary)] text-sm">
                <div className="flex items-center justify-center gap-2">
                  <InlineSpinner size="sm" />
                  Loading projects...
                </div>
              </div>
            ) : filteredProjects.length > 0 ? (
              <div className="py-1">
                {filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleProjectSelect(project)}
                    className={`w-full px-4 py-3 text-left hover:bg-[var(--ff-bg-hover)] transition-colors ${
                      selectedProject?.id === project.id
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-[var(--ff-text-primary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                      <div>
                        <div className="font-medium">{project.name}</div>
                        <div className="text-sm text-[var(--ff-text-secondary)]">{project.code || 'No code'}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : searchTerm ? (
              <div className="px-4 py-6 text-center text-[var(--ff-text-secondary)] text-sm">
                No projects found matching &quot;{searchTerm}&quot;
              </div>
            ) : loadError ? (
              <div className="px-4 py-6 text-center">
                <p className="text-red-600 text-sm mb-2">{loadError}</p>
                <button
                  onClick={loadProjects}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-[var(--ff-text-secondary)] text-sm">
                No active projects available
              </div>
            )}
          </div>

          <div className="p-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
            <div className="flex justify-between items-center text-xs text-[var(--ff-text-secondary)]">
              <span>
                {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''} available
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-primary-600 hover:text-primary-700"
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