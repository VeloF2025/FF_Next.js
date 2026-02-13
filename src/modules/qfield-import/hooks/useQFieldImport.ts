import { useState, useCallback } from 'react';
import { log } from '@/lib/logger';
import type {
  GpkgFile,
  GpkgPreviewResult,
  ImportMode,
  LayerType,
  ImportResult,
  ImportPhase,
} from '../types';

const ALL_LAYERS: LayerType[] = [
  'poles',
  'joints',
  'cable_spans',
  'drops',
  'zone_boundaries',
  'pon_boundaries',
  'pops',
];

export function useQFieldImport(projectId: string) {
  const [phase, setPhase] = useState<ImportPhase>('select');
  const [gpkgFiles, setGpkgFiles] = useState<GpkgFile[]>([]);
  const [preview, setPreview] = useState<GpkgPreviewResult | null>(null);
  const [selectedLayers, setSelectedLayers] = useState<Set<LayerType>>(new Set());
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Scan available GPKG files for a QField project */
  const scanLayers = useCallback(async (qfieldProjectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/qfield/gpkg-layers?qfieldProjectId=${encodeURIComponent(qfieldProjectId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Scan failed' }));
        throw new Error(body.error || `Scan failed (${res.status})`);
      }
      const data = await res.json();
      const files: GpkgFile[] = data.data?.files || data.files || [];
      setGpkgFiles(files);
      log.info('GPKG files scanned', { count: files.length, qfieldProjectId }, 'QFieldImport');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to scan layers';
      setError(msg);
      log.error('Scan layers failed', { error: msg, qfieldProjectId }, 'QFieldImport');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch preview with layer counts and sample fields */
  const fetchPreview = useCallback(async (qfieldProjectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/qfield/gpkg-preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qfieldProjectId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Preview failed' }));
        throw new Error(body.error || `Preview failed (${res.status})`);
      }
      const data = await res.json();
      const result: GpkgPreviewResult = data.data || data;
      setPreview(result);

      // Auto-select all layers that have data
      const available = new Set<LayerType>();
      for (const layer of ALL_LAYERS) {
        if (result.layers[layer] && result.layers[layer]!.count > 0) {
          available.add(layer);
        }
      }
      setSelectedLayers(available);
      setPhase('preview');
      log.info('Preview loaded', { layers: Object.keys(result.layers) }, 'QFieldImport');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load preview';
      setError(msg);
      log.error('Fetch preview failed', { error: msg, qfieldProjectId }, 'QFieldImport');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Execute the import for selected layers */
  const executeImport = useCallback(
    async (qfieldProjectId: string) => {
      if (selectedLayers.size === 0) {
        setError('Select at least one layer to import');
        return;
      }
      setPhase('importing');
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/qfield/gpkg-import', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            qfieldProjectId,
            selectedLayers: Array.from(selectedLayers),
            mode: importMode,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Import failed' }));
          throw new Error(body.error || `Import failed (${res.status})`);
        }
        const data = await res.json();
        const result: ImportResult = data.data || data;
        setImportResult(result);
        setPhase('complete');
        log.info('Import complete', { jobId: result.jobId, results: result.results }, 'QFieldImport');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Import failed';
        setError(msg);
        setPhase('preview');
        log.error('Import failed', { error: msg, projectId }, 'QFieldImport');
      } finally {
        setLoading(false);
      }
    },
    [projectId, selectedLayers, importMode]
  );

  /** Toggle a single layer on/off */
  const toggleLayer = useCallback((layer: LayerType) => {
    setSelectedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }, []);

  /** Select all available layers */
  const selectAllLayers = useCallback(() => {
    if (!preview) return;
    const allSelected =
      ALL_LAYERS.filter((l) => preview.layers[l]?.count).length === selectedLayers.size;
    if (allSelected) {
      setSelectedLayers(new Set());
    } else {
      const available = new Set<LayerType>();
      for (const layer of ALL_LAYERS) {
        if (preview.layers[layer] && preview.layers[layer]!.count > 0) {
          available.add(layer);
        }
      }
      setSelectedLayers(available);
    }
  }, [preview, selectedLayers.size]);

  /** Reset the entire flow back to step 1 */
  const reset = useCallback(() => {
    setPhase('select');
    setGpkgFiles([]);
    setPreview(null);
    setSelectedLayers(new Set());
    setImportMode('merge');
    setImportResult(null);
    setLoading(false);
    setError(null);
  }, []);

  return {
    phase,
    gpkgFiles,
    preview,
    selectedLayers,
    importMode,
    importResult,
    loading,
    error,
    scanLayers,
    fetchPreview,
    executeImport,
    toggleLayer,
    selectAllLayers,
    setImportMode,
    reset,
  };
}
