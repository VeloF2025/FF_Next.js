/**
 * DevQueue Settings Component
 * Configure WIP limits, columns, and notifications
 */

import { useState, useEffect } from 'react';
import { Plus, Trash2, GripVertical, Save, AlertCircle } from 'lucide-react';
import { devQueueService } from '../services/devQueueService';
import { notificationService } from '@/services/core/NotificationService';
import type { DevQueueColumn } from '../types/devQueue';

interface DevQueueSettingsProps {
  columns: DevQueueColumn[];
  onColumnsUpdated: () => void;
}

interface ColumnSettings {
  id: string;
  name: string;
  color: string;
  wip_limit: number | null;
  position: number;
  isNew?: boolean;
}

const DEFAULT_COLORS = [
  '#6b7280', // gray
  '#eab308', // yellow
  '#3b82f6', // blue
  '#a855f7', // purple
  '#f97316', // orange
  '#22c55e', // green
  '#ef4444', // red
  '#06b6d4', // cyan
];

export function DevQueueSettings({ columns, onColumnsUpdated }: DevQueueSettingsProps) {
  const [columnSettings, setColumnSettings] = useState<ColumnSettings[]>([]);
  const [notifyOnStatusChange, setNotifyOnStatusChange] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from columns prop
  useEffect(() => {
    setColumnSettings(
      columns.map((col) => ({
        id: col.id,
        name: col.name,
        color: col.color || '#6b7280',
        wip_limit: col.wip_limit || null,
        position: col.position,
      }))
    );
  }, [columns]);

  const handleColumnChange = (index: number, field: keyof ColumnSettings, value: any) => {
    setColumnSettings((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    setHasChanges(true);
  };

  const handleAddColumn = () => {
    const newPosition = columnSettings.length + 1;
    setColumnSettings((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        name: `New Column ${newPosition}`,
        color: DEFAULT_COLORS[newPosition % DEFAULT_COLORS.length],
        wip_limit: null,
        position: newPosition,
        isNew: true,
      },
    ]);
    setHasChanges(true);
  };

  const handleRemoveColumn = (index: number) => {
    const column = columnSettings[index];
    const originalColumn = columns.find((c) => c.id === column.id);

    if (originalColumn && originalColumn.items.length > 0) {
      notificationService.error('Cannot delete column with items. Move items first.');
      return;
    }

    setColumnSettings((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      // Reorder positions
      return updated.map((col, i) => ({ ...col, position: i + 1 }));
    });
    setHasChanges(true);
  };

  const handleMoveColumn = (fromIndex: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= columnSettings.length) return;

    setColumnSettings((prev) => {
      const updated = [...prev];
      [updated[fromIndex], updated[toIndex]] = [updated[toIndex], updated[fromIndex]];
      // Update positions
      return updated.map((col, i) => ({ ...col, position: i + 1 }));
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await devQueueService.updateColumns(columnSettings);
      notificationService.success('Settings saved successfully');
      setHasChanges(false);
      onColumnsUpdated();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings';
      notificationService.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* WIP Limits & Columns Section */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">
              Column Configuration
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Manage columns and their WIP (Work In Progress) limits
            </p>
          </div>
          <button
            onClick={handleAddColumn}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Column
          </button>
        </div>

        <div className="space-y-3">
          {columnSettings.map((column, index) => (
            <div
              key={column.id}
              className="flex items-center gap-3 p-3 bg-[var(--ff-bg-primary)] rounded-lg border border-[var(--ff-border-light)]"
            >
              {/* Drag Handle */}
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleMoveColumn(index, 'up')}
                  disabled={index === 0}
                  className="p-1 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
              </div>

              {/* Position */}
              <span className="w-6 text-center text-sm text-[var(--ff-text-tertiary)]">
                {column.position}
              </span>

              {/* Color Picker */}
              <input
                type="color"
                value={column.color}
                onChange={(e) => handleColumnChange(index, 'color', e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0"
                title="Column color"
              />

              {/* Column Name */}
              <input
                type="text"
                value={column.name}
                onChange={(e) => handleColumnChange(index, 'name', e.target.value)}
                className="flex-1 px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Column name"
              />

              {/* WIP Limit */}
              <div className="flex items-center gap-2">
                <label className="text-sm text-[var(--ff-text-secondary)] whitespace-nowrap">
                  WIP Limit:
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={column.wip_limit || ''}
                  onChange={(e) =>
                    handleColumnChange(
                      index,
                      'wip_limit',
                      e.target.value ? parseInt(e.target.value, 10) : null
                    )
                  }
                  className="w-16 px-2 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="-"
                />
              </div>

              {/* Delete Button */}
              <button
                onClick={() => handleRemoveColumn(index)}
                className="p-2 text-[var(--ff-text-tertiary)] hover:text-red-500 transition-colors"
                title="Remove column"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {columnSettings.length === 0 && (
          <div className="text-center py-8 text-[var(--ff-text-secondary)]">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No columns configured. Add a column to get started.</p>
          </div>
        )}
      </div>

      {/* Notifications Section */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6">
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">
          Notification Preferences
        </h3>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyOnStatusChange}
              onChange={(e) => {
                setNotifyOnStatusChange(e.target.checked);
                setHasChanges(true);
              }}
              className="w-4 h-4 rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                Status change notifications
              </span>
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Receive notifications when items move between columns
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Voting Rules Section */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6">
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">
          Voting Rules
        </h3>
        <div className="space-y-3 text-sm text-[var(--ff-text-secondary)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span>One vote per user per item (enforced)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span>Clicking vote again removes your vote</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span>Vote counts update in real-time</span>
          </div>
        </div>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`inline-flex items-center px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors ${
              saving ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
