/**
 * Create & Link Project Modal
 * Creates a new project and auto-links it to a pipeline project
 */

import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Loader2,
  Building2,
  User,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import { useClientSelection } from '@/hooks/useClients';
import { useProjectManagerSelection } from '@/hooks/staff';

interface CreateAndLinkProjectModalProps {
  pipelineProjectId: string;
  pipelineProjectName: string;
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: () => void;
}

export function CreateAndLinkProjectModal({
  pipelineProjectId,
  pipelineProjectName,
  isOpen,
  onClose,
  onProjectCreated,
}: CreateAndLinkProjectModalProps) {
  const [projectName, setProjectName] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectManagerId, setProjectManagerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { clients, isLoading: clientsLoading } = useClientSelection();
  const { projectManagers, isLoading: managersLoading } = useProjectManagerSelection();

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setProjectName(pipelineProjectName);
      setClientId('');
      setProjectManagerId('');
      setStartDate(new Date().toISOString().split('T')[0] ?? '');
      setPriority('MEDIUM');
      setError(null);
    }
  }, [isOpen, pipelineProjectName]);

  const handleSubmit = async () => {
    if (!projectName.trim()) {
      setError('Project name is required');
      return;
    }
    if (!clientId) {
      setError('Please select a client');
      return;
    }
    if (!projectManagerId) {
      setError('Please select a project manager');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Step 1: Create the project
      const createResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          project_name: projectName.trim(),
          client_id: clientId,
          project_manager: projectManagerId,
          start_date: startDate || null,
          priority,
          status: 'PLANNING',
        }),
      });

      const createResult = await createResponse.json();

      if (!createResult.success || !createResult.data?.id) {
        setError(createResult.error?.message || 'Failed to create project');
        return;
      }

      const newProjectId = createResult.data.id;

      // Step 2: Link to pipeline project
      const linkResponse = await fetch(`/api/projects/${newProjectId}/pipeline-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pipeline_project_id: pipelineProjectId,
          is_primary: true,
          notes: `Auto-linked on project creation from pipeline`,
        }),
      });

      const linkResult = await linkResponse.json();

      if (!linkResult.success) {
        // Project was created but linking failed — warn but don't block
        log.warn('Project created but pipeline link failed', {
          newProjectId,
          pipelineProjectId,
          error: linkResult.error,
        }, 'CreateAndLinkProjectModal');
        setError(`Project created (${newProjectId}) but linking failed: ${linkResult.error?.message || 'Unknown error'}. You can link it manually.`);
        return;
      }

      log.info('Created and linked project', {
        newProjectId,
        pipelineProjectId,
      }, 'CreateAndLinkProjectModal');

      notificationService.success(`Project "${projectName.trim()}" created and linked successfully`);
      onProjectCreated();
      onClose();
    } catch (err) {
      log.error('Failed to create and link project', { err }, 'CreateAndLinkProjectModal');
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)] shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
              <Plus className="w-5 h-5 text-green-500" />
              Create &amp; Link New Project
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Create a project and link it to &quot;{pipelineProjectName}&quot;
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter project name"
            />
          </div>

          {/* Client */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              <span className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5" />
                Client <span className="text-red-500">*</span>
              </span>
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={clientsLoading}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="">{clientsLoading ? 'Loading clients...' : 'Select a client'}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          {/* Project Manager */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                Project Manager <span className="text-red-500">*</span>
              </span>
            </label>
            <select
              value={projectManagerId}
              onChange={(e) => setProjectManagerId(e.target.value)}
              disabled={managersLoading}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="">{managersLoading ? 'Loading managers...' : 'Select a project manager'}</option>
              {projectManagers.map((pm) => (
                <option key={pm.id} value={pm.id}>
                  {pm.name}
                </option>
              ))}
            </select>
          </div>

          {/* Start Date & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Start Date
                </span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-[var(--ff-border-light)] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !projectName.trim() || !clientId || !projectManagerId}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Create &amp; Link
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateAndLinkProjectModal;
