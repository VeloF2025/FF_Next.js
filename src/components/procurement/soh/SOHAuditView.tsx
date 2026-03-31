/**
 * SOHAuditView — Version-stamped SOH audit import/export table
 * Component B of the SOH sub-page in Stock View
 */
'use client';
import { useState, useEffect, useRef } from 'react';
import { Download, Upload, Plus, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SOHAuditTable } from './SOHAuditTable';
import type { SOHAuditVersion, SOHAuditEntry } from '@/pages/api/procurement/soh-audit/versions';
import type { SOHWarehouse } from '@/pages/api/procurement/soh-audit/warehouses';
import type { Project } from '@/types/project.types';
import { log } from '@/lib/logger';

interface SOHAuditViewProps {
  selectedProject?: Project;
}

export function SOHAuditView({ selectedProject: _selectedProject }: SOHAuditViewProps) {
  const [versions, setVersions] = useState<SOHAuditVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<SOHAuditEntry[]>([]);
  const [warehouses, setWarehouses] = useState<SOHWarehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showAddWarehouse, setShowAddWarehouse] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState('');
  const [newWarehouseType, setNewWarehouseType] = useState<'warehouse' | 'project' | 'dc'>('project');
  const [importLabel, setImportLabel] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadWarehouses();
    void loadVersions();
  }, []);

  useEffect(() => {
    if (selectedVersionId) void loadEntries(selectedVersionId);
    else setEntries([]);
  }, [selectedVersionId]);

  async function loadWarehouses() {
    try {
      const res = await fetch('/api/procurement/soh-audit/warehouses');
      const json = await res.json() as { data: SOHWarehouse[] };
      setWarehouses(json.data ?? []);
    } catch (err) {
      log.error('Failed to load warehouses', { error: (err as Error).message }, 'SOHAuditView');
    }
  }

  async function loadVersions() {
    try {
      const res = await fetch('/api/procurement/soh-audit/versions');
      const json = await res.json() as { data: SOHAuditVersion[] };
      const list = json.data ?? [];
      setVersions(list);
      if (list.length > 0 && !selectedVersionId) setSelectedVersionId(list[0]!.id);
    } catch (err) {
      log.error('Failed to load versions', { error: (err as Error).message }, 'SOHAuditView');
    }
  }

  async function loadEntries(versionId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/procurement/soh-audit/versions?id=${versionId}`);
      const json = await res.json() as { data: SOHAuditVersion };
      setEntries(json.data?.entries ?? []);
    } catch (err) {
      log.error('Failed to load entries', { error: (err as Error).message }, 'SOHAuditView');
    } finally {
      setLoading(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setImportLabel(`Import ${new Date().toISOString().slice(0, 10)}`);
    setShowImportModal(true);
  }

  async function handleImport() {
    if (!pendingFile || !importLabel.trim()) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', pendingFile);
      formData.append('version_label', importLabel.trim());
      const res = await fetch('/api/procurement/soh-audit/import', { method: 'POST', body: formData });
      const json = await res.json() as { data: { version_id: string; rows_imported: number } };
      if (res.ok) {
        await loadVersions();
        setSelectedVersionId(json.data.version_id);
        setShowImportModal(false);
        setPendingFile(null);
      }
    } catch (err) {
      log.error('Import failed', { error: (err as Error).message }, 'SOHAuditView');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleAddWarehouse() {
    if (!newWarehouseName.trim()) return;
    try {
      await fetch('/api/procurement/soh-audit/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWarehouseName.trim(), type: newWarehouseType }),
      });
      await loadWarehouses();
      setNewWarehouseName('');
      setShowAddWarehouse(false);
    } catch (err) {
      log.error('Failed to add warehouse', { error: (err as Error).message }, 'SOHAuditView');
    }
  }

  const selectedVersion = versions.find(v => v.id === selectedVersionId);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Version selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Audit Version:</label>
          <div className="relative">
            <select
              value={selectedVersionId ?? ''}
              onChange={e => setSelectedVersionId(e.target.value || null)}
              className="h-8 pl-3 pr-8 rounded border border-border bg-background text-xs text-foreground appearance-none cursor-pointer min-w-[220px]"
            >
              {versions.length === 0 && <option value="">No imports yet</option>}
              {versions.map(v => (
                <option key={v.id} value={v.id}>
                  {v.version_label} — {new Date(v.created_at).toLocaleDateString('en-ZA')} ({v.entry_count ?? 0} items)
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
            onClick={() => window.open('/api/procurement/soh-audit/template', '_blank')}>
            <Download className="h-3.5 w-3.5" />
            Template
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelect} />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Import Excel
          </Button>
          {selectedVersion && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
              onClick={() => window.open(`/api/procurement/soh-audit/export?versionId=${selectedVersionId}`, '_blank')}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
            onClick={() => setShowAddWarehouse(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add Location
          </Button>
        </div>
      </div>

      {/* Table */}
      <SOHAuditTable entries={entries} warehouses={warehouses} loading={loading} />

      {/* Import modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="text-sm font-semibold text-foreground mb-4">Import SOH Audit</h2>
            <label className="block text-xs text-muted-foreground mb-1">Version Label</label>
            <input value={importLabel} onChange={e => setImportLabel(e.target.value)}
              className="w-full h-8 px-3 rounded border border-border bg-background text-xs text-foreground mb-4"
              placeholder="e.g. 2026-03-31 Physical Count" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowImportModal(false); setPendingFile(null); }}>Cancel</Button>
              <Button size="sm" onClick={() => void handleImport()} disabled={importing || !importLabel.trim()}>
                {importing ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add warehouse modal */}
      {showAddWarehouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-sm font-semibold text-foreground mb-4">Add Location</h2>
            <label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input value={newWarehouseName} onChange={e => setNewWarehouseName(e.target.value)}
              className="w-full h-8 px-3 rounded border border-border bg-background text-xs text-foreground mb-3"
              placeholder="e.g. Soweto POP 1" />
            <label className="block text-xs text-muted-foreground mb-1">Type</label>
            <select value={newWarehouseType} onChange={e => setNewWarehouseType(e.target.value as 'warehouse' | 'project' | 'dc')}
              className="w-full h-8 px-3 rounded border border-border bg-background text-xs text-foreground mb-4">
              <option value="project">Project</option>
              <option value="warehouse">Warehouse</option>
              <option value="dc">DC</option>
            </select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddWarehouse(false)}>Cancel</Button>
              <Button size="sm" onClick={() => void handleAddWarehouse()} disabled={!newWarehouseName.trim()}>Add</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
