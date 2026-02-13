import { useState, useEffect, useCallback } from 'react';
import { Database, Loader2, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import { log } from '@/lib/logger';
import { useQFieldImport } from '../hooks/useQFieldImport';
import { LayerPreviewCard } from './LayerPreviewCard';
import { ImportProgressBar } from './ImportProgressBar';
import type { LayerType, ImportMode } from '../types';

interface QFieldImportPanelProps {
  projectId: string;
}

interface LinkedQFieldProject {
  id: string;
  name: string;
  qfield_project_id: string;
}

export function QFieldImportPanel({ projectId }: QFieldImportPanelProps) {
  const [linkedProjects, setLinkedProjects] = useState<LinkedQFieldProject[]>([]);
  const [selectedQFieldId, setSelectedQFieldId] = useState<string>('');
  const [loadingLinked, setLoadingLinked] = useState(true);

  const {
    phase,
    preview,
    selectedLayers,
    importMode,
    importResult,
    loading,
    error,
    fetchPreview,
    executeImport,
    toggleLayer,
    selectAllLayers,
    setImportMode,
    reset,
  } = useQFieldImport(projectId);

  /** Fetch linked QField projects for this FibreFlow project */
  const fetchLinkedProjects = useCallback(async () => {
    try {
      setLoadingLinked(true);
      const res = await fetch(
        `/api/qfield/projects?projectId=${encodeURIComponent(projectId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      const projects: LinkedQFieldProject[] = data.data?.projects || data.projects || [];
      setLinkedProjects(projects);
      const first = projects[0];
      if (projects.length === 1 && first) {
        setSelectedQFieldId(first.qfield_project_id);
      }
    } catch (err) {
      log.error('Failed to fetch linked QField projects', { projectId, error: err }, 'QFieldImport');
    } finally {
      setLoadingLinked(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchLinkedProjects();
  }, [fetchLinkedProjects]);

  const handleScanAndPreview = async () => {
    if (!selectedQFieldId) return;
    await fetchPreview(selectedQFieldId);
  };

  const handleStartImport = async () => {
    if (!selectedQFieldId) return;
    await executeImport(selectedQFieldId);
  };

  const availableLayers = preview
    ? (Object.keys(preview.layers) as LayerType[]).filter(
        (l) => preview.layers[l] && preview.layers[l]!.count > 0
      )
    : [];

  const allSelected = availableLayers.length > 0 && selectedLayers.size === availableLayers.length;

  return (
    <div className="space-y-4">
      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Phase 1: Select QField project */}
      {phase === 'select' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              {loadingLinked ? (
                <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading linked projects...
                </div>
              ) : linkedProjects.length > 1 ? (
                <div className="relative">
                  <select
                    value={selectedQFieldId}
                    onChange={(e) => setSelectedQFieldId(e.target.value)}
                    className="w-full appearance-none bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-3 py-2 pr-8 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select QField project...</option>
                    {linkedProjects.map((p) => (
                      <option key={p.qfield_project_id} value={p.qfield_project_id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-secondary)] pointer-events-none" />
                </div>
              ) : linkedProjects.length === 1 && linkedProjects[0] ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <Database className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {linkedProjects[0].name}
                  </span>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={selectedQFieldId}
                    onChange={(e) => setSelectedQFieldId(e.target.value)}
                    placeholder="Enter QField project ID..."
                    className="w-full bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-3 py-2 text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                    No linked QField projects found. Enter the project ID manually.
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleScanAndPreview}
              disabled={!selectedQFieldId || loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              Scan Layers
            </button>
          </div>
        </div>
      )}

      {/* Phase 2: Preview and configure */}
      {phase === 'preview' && preview && (
        <div className="space-y-4">
          {/* Layer selection header */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {availableLayers.length} layer{availableLayers.length !== 1 ? 's' : ''} found
              {' -- '}
              {selectedLayers.size} selected
            </p>
            <button
              type="button"
              onClick={selectAllLayers}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* Layer cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {availableLayers.map((layer) => (
              <LayerPreviewCard
                key={layer}
                layerType={layer}
                preview={preview.layers[layer]!}
                selected={selectedLayers.has(layer)}
                onToggle={() => toggleLayer(layer)}
              />
            ))}
          </div>

          {/* Import mode */}
          <div className="p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
            <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">Import Mode</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <ImportModeOption
                mode="merge"
                label="Merge"
                description="Update only empty fields, keep existing data"
                selected={importMode === 'merge'}
                onSelect={() => setImportMode('merge')}
              />
              <ImportModeOption
                mode="replace"
                label="Replace"
                description="Delete existing data and insert fresh from GeoPackage"
                selected={importMode === 'replace'}
                onSelect={() => setImportMode('replace')}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleStartImport}
              disabled={selectedLayers.size === 0 || loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              Start Import ({selectedLayers.size} layer{selectedLayers.size !== 1 ? 's' : ''})
            </button>
          </div>
        </div>
      )}

      {/* Phase 3: Importing / Complete */}
      {(phase === 'importing' || phase === 'complete') && (
        <div className="space-y-4">
          <ImportProgressBar result={importResult} importing={phase === 'importing'} />

          {phase === 'complete' && (
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={reset}
                className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Import Again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Radio-style option for import mode */
function ImportModeOption({
  mode,
  label,
  description,
  selected,
  onSelect,
}: {
  mode: ImportMode;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex-1 text-left p-3 rounded-lg border transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-card)] hover:bg-[var(--ff-bg-hover)]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
            selected ? 'border-blue-500' : 'border-[var(--ff-border-light)]'
          }`}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-blue-500" />}
        </div>
        <span className="text-sm font-medium text-[var(--ff-text-primary)]">{label}</span>
      </div>
      <p className="text-xs text-[var(--ff-text-secondary)] ml-6">{description}</p>
    </button>
  );
}
