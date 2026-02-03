/**
 * Link Pipeline Modal
 * Modal to link a project to one or more pipeline areas
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Search,
  Loader2,
  Link2,
  MapPin,
  Building,
  CheckCircle,
  Star,
} from 'lucide-react';
import { log } from '@/lib/logger';

interface PipelineProject {
  id: string;
  project_name: string;
  pipeline_status: string;
  area: string | null;
  municipality: string | null;
  province: string | null;
  client_id: string | null;
  client_name: string | null;
  approval_count: number;
  approved_count: number;
}

interface LinkPipelineModalProps {
  projectId: string;
  projectName: string;
  isOpen: boolean;
  onClose: () => void;
  onLinkCreated: () => void;
}

function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

const statusLabels: Record<string, string> = {
  lead: 'Lead',
  qualifying: 'Qualifying',
  planning: 'Planning',
  ready_to_plan: 'Ready to Plan',
  planned: 'Planned',
  on_hold: 'On Hold',
  lost: 'Lost',
};

const statusColors: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  qualifying: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  planning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  ready_to_plan: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  planned: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  on_hold: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  lost: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function LinkPipelineModal({
  projectId,
  projectName,
  isOpen,
  onClose,
  onLinkCreated,
}: LinkPipelineModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProject, setSelectedProject] = useState<PipelineProject | null>(null);
  const [setAsPrimary, setSetAsPrimary] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async (query: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        project_id: projectId,
        limit: '20',
      });
      if (query) {
        params.set('q', query);
      }

      const response = await fetch(`/api/pipeline/projects/search?${params}`);
      const result = await response.json();

      if (result.success) {
        setProjects(result.data.projects);
      } else {
        setError(result.error?.message || 'Failed to search projects');
      }
    } catch (err) {
      log.error('Failed to search pipeline projects', { err }, 'LinkPipelineModal');
      setError('Failed to search pipeline projects');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSearch = useCallback(
    debounce((query: string) => fetchProjects(query), 300),
    [fetchProjects]
  );

  useEffect(() => {
    if (isOpen) {
      fetchProjects('');
    }
  }, [isOpen, fetchProjects]);

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  const handleSubmit = async () => {
    if (!selectedProject) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/pipeline-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipeline_project_id: selectedProject.id,
          is_primary: setAsPrimary,
          notes: notes || null,
        }),
      });

      const result = await response.json();

      if (result.success) {
        onLinkCreated();
        onClose();
        setSelectedProject(null);
        setNotes('');
        setSearchQuery('');
      } else {
        setError(result.error?.message || 'Failed to create link');
      }
    } catch (err) {
      log.error('Failed to create pipeline link', { err }, 'LinkPipelineModal');
      setError('Failed to create pipeline link');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/85" onClick={onClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-xl bg-[var(--ff-card-bg)] rounded-lg shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                <Link2 className="w-5 h-5 text-blue-500" />
                Link Pipeline Area
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                Link &quot;{projectName}&quot; to a pipeline project
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-secondary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search pipeline projects..."
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Project List */}
            <div className="max-h-64 overflow-y-auto border border-[var(--ff-border-light)] rounded-lg divide-y divide-[var(--ff-border-light)]">
              {isLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                </div>
              ) : projects.length === 0 ? (
                <div className="p-8 text-center text-[var(--ff-text-secondary)]">
                  {searchQuery
                    ? 'No matching pipeline projects found'
                    : 'No available pipeline projects'}
                </div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => setSelectedProject(project)}
                    className={`w-full p-3 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors ${
                      selectedProject?.id === project.id
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {selectedProject?.id === project.id && (
                            <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          )}
                          <span className="font-medium text-[var(--ff-text-primary)] truncate">
                            {project.project_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--ff-text-secondary)]">
                          {(project.area || project.municipality) && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {[project.area, project.municipality].filter(Boolean).join(', ')}
                            </span>
                          )}
                          {project.client_name && (
                            <span className="flex items-center gap-1">
                              <Building className="w-3 h-3" />
                              {project.client_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            statusColors[project.pipeline_status] || statusColors.lead
                          }`}
                        >
                          {statusLabels[project.pipeline_status] || project.pipeline_status}
                        </span>
                        {project.approval_count > 0 && (
                          <span className="text-xs text-[var(--ff-text-secondary)]">
                            {project.approved_count}/{project.approval_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Options */}
            {selectedProject && (
              <div className="space-y-3 p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setAsPrimary}
                    onChange={(e) => setSetAsPrimary(e.target.checked)}
                    className="w-4 h-4 text-blue-500 border-[var(--ff-border-light)] rounded focus:ring-blue-500"
                  />
                  <span className="flex items-center gap-2 text-sm text-[var(--ff-text-primary)]">
                    <Star className="w-4 h-4 text-amber-500" />
                    Set as primary link
                  </span>
                </label>
                <p className="text-xs text-[var(--ff-text-secondary)] ml-7">
                  Primary link determines which pipeline&apos;s wayleaves are shown by default
                </p>

                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any notes about this link..."
                    rows={2}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-4 border-t border-[var(--ff-border-light)]">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selectedProject || isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Linking...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4" />
                  Link Pipeline
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LinkPipelineModal;
