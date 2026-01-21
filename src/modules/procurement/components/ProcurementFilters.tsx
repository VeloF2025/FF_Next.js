/**
 * Procurement Filters - Date range and Project selection
 *
 * Compact filter bar for the procurement dashboard
 */

import { useState, useRef, useEffect } from 'react';
import {
  Calendar,
  ChevronDown,
  Building2,
  Check,
  X,
} from 'lucide-react';
import type { Project } from '@/types/project.types';

// Date range presets
type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all';

interface DateRange {
  preset: DatePreset;
  label: string;
  from?: Date;
  to?: Date;
}

interface ProcurementFiltersProps {
  selectedProject?: Project;
  onProjectChange: (project: Project | undefined) => void;
  dateRange?: DatePreset;
  onDateRangeChange?: (preset: DatePreset) => void;
  projects?: Array<{ id: string; name: string; code: string }>;
  isLoading?: boolean;
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
];

export function ProcurementFilters({
  selectedProject,
  onProjectChange,
  dateRange = 'month',
  onDateRangeChange,
  projects = [],
  isLoading = false,
}: ProcurementFiltersProps) {
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [localProjects, setLocalProjects] = useState(projects);

  const dateRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

  // Fetch projects if not provided
  useEffect(() => {
    if (projects.length === 0) {
      fetch('/api/projects')
        .then(res => res.json())
        .then(data => {
          const projectList = data.data || data || [];
          setLocalProjects(projectList.slice(0, 20)); // Limit to 20
        })
        .catch(() => {
          // Fallback - empty list
          setLocalProjects([]);
        });
    }
  }, [projects.length]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dateRef.current && !dateRef.current.contains(event.target as Node)) {
        setDateDropdownOpen(false);
      }
      if (projectRef.current && !projectRef.current.contains(event.target as Node)) {
        setProjectDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedDateLabel = DATE_PRESETS.find(p => p.value === dateRange)?.label || 'This Month';
  const displayProjects = localProjects.length > 0 ? localProjects : projects;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Date Range Filter */}
      <div className="relative" ref={dateRef}>
        <button
          type="button"
          onClick={() => setDateDropdownOpen(!dateDropdownOpen)}
          className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg hover:border-purple-500/50 transition-colors text-sm"
        >
          <Calendar className="h-4 w-4 text-purple-500" />
          <span className="text-[var(--ff-text-primary)]">{selectedDateLabel}</span>
          <ChevronDown className={`h-4 w-4 text-[var(--ff-text-tertiary)] transition-transform ${dateDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dateDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg shadow-lg z-50 py-1 min-w-[140px]">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  onDateRangeChange?.(preset.value);
                  setDateDropdownOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-[var(--ff-bg-tertiary)] transition-colors ${
                  dateRange === preset.value ? 'text-purple-400' : 'text-[var(--ff-text-primary)]'
                }`}
              >
                {preset.label}
                {dateRange === preset.value && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Project Filter */}
      <div className="relative" ref={projectRef}>
        <button
          type="button"
          onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg hover:border-purple-500/50 transition-colors text-sm min-w-[180px]"
        >
          <Building2 className="h-4 w-4 text-blue-500" />
          <span className="text-[var(--ff-text-primary)] truncate flex-1 text-left">
            {selectedProject ? selectedProject.name : 'All Projects'}
          </span>
          {selectedProject && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onProjectChange(undefined);
              }}
              className="p-0.5 hover:bg-[var(--ff-bg-tertiary)] rounded"
            >
              <X className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 text-[var(--ff-text-tertiary)] transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {projectDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg shadow-lg z-50 py-1 min-w-[220px] max-h-[300px] overflow-y-auto">
            {/* All Projects option */}
            <button
              type="button"
              onClick={() => {
                onProjectChange(undefined);
                setProjectDropdownOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-[var(--ff-bg-tertiary)] transition-colors ${
                !selectedProject ? 'text-blue-400 bg-blue-500/10' : 'text-[var(--ff-text-primary)]'
              }`}
            >
              <span>All Projects</span>
              {!selectedProject && <Check className="h-4 w-4" />}
            </button>

            {displayProjects.length > 0 && (
              <div className="border-t border-[var(--ff-border)] my-1" />
            )}

            {displayProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  onProjectChange(project as Project);
                  setProjectDropdownOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-[var(--ff-bg-tertiary)] transition-colors ${
                  selectedProject?.id === project.id ? 'text-purple-400 bg-purple-500/10' : 'text-[var(--ff-text-primary)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate">{project.name}</div>
                  <div className="text-xs text-[var(--ff-text-tertiary)]">{project.code}</div>
                </div>
                {selectedProject?.id === project.id && <Check className="h-4 w-4 flex-shrink-0" />}
              </button>
            ))}

            {displayProjects.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-[var(--ff-text-tertiary)]">
                No projects found
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active filter indicator */}
      {(selectedProject || dateRange !== 'all') && (
        <button
          type="button"
          onClick={() => {
            onProjectChange(undefined);
            onDateRangeChange?.('all');
          }}
          className="text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

export default ProcurementFilters;
