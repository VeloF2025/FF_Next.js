/**
 * Settings Tab - WhatsApp Service Configuration
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Save,
  Loader2,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Server,
  Shield,
  ToggleLeft,
  Settings2,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaServiceConfig } from '../types/wa-admin.types';

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  service: Server,
  validation: Shield,
  feature: ToggleLeft,
  general: Settings2,
};

const CATEGORY_LABELS: Record<string, string> = {
  service: 'Service Configuration',
  validation: 'Validation Rules',
  feature: 'Feature Flags',
  general: 'General Settings',
};

const SettingsTab: React.FC = () => {
  const [configs, setConfigs] = useState<WaServiceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await waAdminApi.config.list();

    if (result.success && result.data) {
      setConfigs(result.data);
      // Initialize edited values
      const values: Record<string, string> = {};
      for (const config of result.data) {
        values[config.config_key] = config.config_value;
      }
      setEditedValues(values);
    } else {
      setError(result.error || 'Failed to fetch configuration');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (config: WaServiceConfig) => {
    const newValue = editedValues[config.config_key];
    if (!newValue || newValue === config.config_value) return;

    setSavingKey(config.config_key);

    const result = await waAdminApi.config.update(config.config_key, newValue);

    if (result.success) {
      setSuccessKey(config.config_key);
      setTimeout(() => setSuccessKey(null), 2000);
      fetchConfigs();
      notificationService.success('Configuration saved successfully');
    } else {
      notificationService.error(result.error || 'Failed to save configuration');
    }

    setSavingKey(null);
  };

  const handleReset = (config: WaServiceConfig) => {
    setEditedValues((prev) => ({ ...prev, [config.config_key]: config.config_value }));
  };

  // Group configs by category
  const groupedConfigs = configs.reduce(
    (acc, config) => {
      const category = config.category || 'general';
      if (!acc[category]) acc[category] = [];
      acc[category].push(config);
      return acc;
    },
    {} as Record<string, WaServiceConfig[]>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading configuration">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" aria-hidden="true" />
        <span className="sr-only">Loading configuration...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchConfigs}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Configuration Settings
        </h3>

        <button
          onClick={fetchConfigs}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Config Groups */}
      {['service', 'validation', 'feature', 'general'].map((category) => {
        const categoryConfigs = groupedConfigs[category];
        if (!categoryConfigs || categoryConfigs.length === 0) return null;

        const Icon = CATEGORY_ICONS[category] || Settings2;

        return (
          <div key={category} className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            <div className="bg-[var(--ff-bg-secondary)] px-4 py-3 border-b border-[var(--ff-border-light)] flex items-center gap-2">
              <Icon className="w-5 h-5 text-[var(--ff-text-secondary)]" />
              <h4 className="font-medium text-[var(--ff-text-primary)]">
                {CATEGORY_LABELS[category] || category}
              </h4>
            </div>

            <div className="divide-y divide-[var(--ff-border-light)]">
              {categoryConfigs.map((config) => (
                <ConfigRow
                  key={config.config_key}
                  config={config}
                  value={editedValues[config.config_key] || ''}
                  onChange={(value) => handleChange(config.config_key, value)}
                  onSave={() => handleSave(config)}
                  onReset={() => handleReset(config)}
                  isSaving={savingKey === config.config_key}
                  isSuccess={successKey === config.config_key}
                  isModified={editedValues[config.config_key] !== config.config_value}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Warning Notice */}
      <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-600 dark:text-yellow-400 text-sm">
        <strong>Note:</strong> Some configuration changes may require a service restart to take effect.
        Use the Services tab to restart WhatsApp services after making changes.
      </div>
    </div>
  );
};

interface ConfigRowProps {
  config: WaServiceConfig;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  isSaving: boolean;
  isSuccess: boolean;
  isModified: boolean;
}

const ConfigRow: React.FC<ConfigRowProps> = ({
  config,
  value,
  onChange,
  onSave,
  onReset,
  isSaving,
  isSuccess,
  isModified,
}) => {
  const renderInput = () => {
    const inputClass = "w-full px-3 py-2 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500";

    // Handle boolean type
    if (config.config_type === 'boolean') {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      );
    }

    // Handle number type
    if (config.config_type === 'number') {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      );
    }

    // Handle JSON type
    if (config.config_type === 'json') {
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={`${inputClass} font-mono text-sm`}
        />
      );
    }

    // Check if this looks like a URL
    if (config.config_key.includes('url') || config.config_key.includes('endpoint')) {
      return (
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} font-mono text-sm`}
          placeholder="https://..."
        />
      );
    }

    // Check if masked (sensitive)
    if (config.is_sensitive && config.config_value?.includes('***')) {
      return (
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder="Enter new value to change"
        />
      );
    }

    // Default string input
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    );
  };

  const inputId = `config-${config.config_key}`;

  return (
    <div className="px-4 py-4">
      <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-4">
        {/* Label and Description */}
        <div className="flex-1 min-w-0">
          <label htmlFor={inputId} className="block font-medium text-[var(--ff-text-primary)]">
            {formatLabel(config.config_key)}
          </label>
          {config.description && (
            <p id={`${inputId}-desc`} className="text-sm text-[var(--ff-text-secondary)] mt-0.5">{config.description}</p>
          )}
          <code className="text-xs text-[var(--ff-text-tertiary)] mt-1 block">{config.config_key}</code>
        </div>

        {/* Input and Actions */}
        <div className="w-full lg:w-80 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex-1">{renderInput()}</div>

            {isModified && (
              <>
                <button
                  onClick={onReset}
                  className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
                  aria-label={`Reset ${formatLabel(config.config_key)}`}
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  onClick={onSave}
                  disabled={isSaving}
                  className="p-2 text-green-600 hover:text-green-700 hover:bg-green-500/10 rounded disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
                  aria-label={`Save ${formatLabel(config.config_key)}`}
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : isSuccess ? (
                    <CheckCircle className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Save className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </>
            )}

            {isSuccess && !isModified && (
              <CheckCircle className="w-5 h-5 text-green-500" aria-label="Saved successfully" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Format config key to human-readable label
 */
function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/Url/g, 'URL')
    .replace(/Api/g, 'API')
    .replace(/Wa/g, 'WA');
}

export default SettingsTab;
