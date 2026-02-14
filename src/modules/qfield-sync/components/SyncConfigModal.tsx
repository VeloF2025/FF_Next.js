/**
 * Sync Config Modal Component
 * Configuration modal for QField sync settings
 */

import React, { useState } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { QFieldSyncConfig } from '../types/qfield-sync.types';

interface SyncConfigModalProps {
  config?: QFieldSyncConfig;
  onClose: () => void;
  onSave: (config: QFieldSyncConfig) => void;
}

export function SyncConfigModal({ config, onClose, onSave }: SyncConfigModalProps) {
  const [formData, setFormData] = useState<QFieldSyncConfig>(
    config || {
      qfieldcloud: {
        url: 'https://qfield.fibreflow.app',
        projectId: '',
        apiKey: '',
        pollingInterval: 300,
      },
      fibreflow: {
        databaseUrl: '',
        targetTable: 'sow_fibre',
      },
      mapping: [],
      syncMode: 'automatic',
      syncDirection: 'bidirectional',
      autoResolveConflicts: false,
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sync Configuration</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-400"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* QFieldCloud Settings */}
          <div>
            <h3 className="text-md font-medium text-gray-900 dark:text-gray-100 mb-4">QFieldCloud Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  QFieldCloud URL
                </label>
                <input
                  type="url"
                  value={formData.qfieldcloud.url}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      qfieldcloud: { ...formData.qfieldcloud, url: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Project ID
                </label>
                <input
                  type="text"
                  value={formData.qfieldcloud.projectId}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      qfieldcloud: { ...formData.qfieldcloud, projectId: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter QFieldCloud project ID"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={formData.qfieldcloud.apiKey}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      qfieldcloud: { ...formData.qfieldcloud, apiKey: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter QFieldCloud API key"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  API key is securely stored and never displayed
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Polling Interval (seconds)
                </label>
                <input
                  type="number"
                  value={formData.qfieldcloud.pollingInterval}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      qfieldcloud: {
                        ...formData.qfieldcloud,
                        pollingInterval: parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  min="30"
                  max="3600"
                />
              </div>
            </div>
          </div>

          {/* Sync Settings */}
          <div>
            <h3 className="text-md font-medium text-gray-900 dark:text-gray-100 mb-4">Sync Settings</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sync Mode
                </label>
                <select
                  value={formData.syncMode}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      syncMode: e.target.value as QFieldSyncConfig['syncMode'],
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="manual">Manual</option>
                  <option value="automatic">Automatic</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sync Direction
                </label>
                <select
                  value={formData.syncDirection}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      syncDirection: e.target.value as QFieldSyncConfig['syncDirection'],
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="qfield_to_fibreflow">QField → FibreFlow</option>
                  <option value="fibreflow_to_qfield">FibreFlow → QField</option>
                  <option value="bidirectional">Bidirectional</option>
                </select>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="autoResolve"
                  checked={formData.autoResolveConflicts}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      autoResolveConflicts: e.target.checked,
                    })
                  }
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
                />
                <label htmlFor="autoResolve" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                  Automatically resolve conflicts
                </label>
              </div>

              {formData.autoResolveConflicts && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                  <div className="flex">
                    <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0" />
                    <div className="ml-3">
                      <p className="text-sm text-amber-800">
                        When enabled, conflicts will be automatically resolved using the most recent data.
                        This may result in data loss if not carefully monitored.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* FibreFlow Settings */}
          <div>
            <h3 className="text-md font-medium text-gray-900 dark:text-gray-100 mb-4">FibreFlow Database</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Target Table
                </label>
                <input
                  type="text"
                  value={formData.fibreflow.targetTable}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      fibreflow: { ...formData.fibreflow, targetTable: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}