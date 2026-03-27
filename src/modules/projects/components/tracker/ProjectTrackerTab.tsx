/**
 * ProjectTrackerTab
 * Top-level Tracker tab: editable Excel-style PON master tracker
 */

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { log } from '@/lib/logger';
import type { TrackerRowData, TrackerRowValue } from './TrackerTypes';
import TrackerTable from './TrackerTable';

let _nextId = 1;
const newClientId = () => `new-${_nextId++}`;

const EMPTY_ROW = (): TrackerRowData => ({
  id: newClientId(),
  zoneNo: null, hldPon: null, zPon: null, oltPort: null,
  scopePoles: null, scopeDrops: null, polePermission: null,
  polesPlanted: null, cwcPolesDate: null, cwcStringingDate: null,
  readyForOptical: null, cwcQaApproved: false,
  opticalSplicingDate: null, opticalSubmittedDate: null,
  opticalActivatedDate: null, atpQaApproved: false,
  signUps: null, homesPo: null, homesRecon: null,
  activated: null, available: null, blockage: null,
  isNew: true,
});

interface Props {
  projectId: string;
}

export function ProjectTrackerTab({ projectId }: Props): ReactNode {
  const [rows, setRows] = useState<TrackerRowData[]>([]);
  const [draftRows, setDraftRows] = useState<TrackerRowData[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/tracker`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { success: boolean; data?: TrackerRowData[] };
      if (json.success) setRows(json.data ?? []);
    } catch (err) {
      log.error('Failed to fetch tracker data', { err, projectId }, 'ProjectTrackerTab');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleEdit = () => {
    setDraftRows(rows.map(r => ({ ...r })));
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setDraftRows([]);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch(`/api/projects/${projectId}/tracker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: draftRows }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { success: boolean; data?: TrackerRowData[] };
      if (json.success) {
        setRows(json.data ?? draftRows);
        setEditing(false);
        setDraftRows([]);
      }
    } catch (err) {
      log.error('Failed to save tracker data', { err, projectId }, 'ProjectTrackerTab');
    } finally {
      setSaving(false);
    }
  };

  const handleAddRow = () => setDraftRows(prev => [...prev, EMPTY_ROW()]);

  const handleChange = (id: string, field: keyof TrackerRowData, value: TrackerRowValue) => {
    setDraftRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleDeleteRow = (id: string) => {
    setDraftRows(prev => prev.filter(r => r.id !== id));
  };

  if (loading) {
    return (
      <div className="p-6 text-[var(--ff-text-secondary)] text-sm">
        Loading tracker data...
      </div>
    );
  }

  const displayRows = editing ? draftRows : rows;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">PON Master Tracker</h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {rows.length} PON{rows.length !== 1 ? 's' : ''}
            {editing && <span className="ml-2 text-amber-400">· Editing</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <button
              type="button"
              onClick={handleEdit}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition-colors"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleAddRow}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium transition-colors"
              >
                + Add Row
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] text-sm rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)]">
        <TrackerTable
          rows={displayRows}
          editing={editing}
          onChange={handleChange}
          onDeleteRow={handleDeleteRow}
        />
      </div>
    </div>
  );
}
