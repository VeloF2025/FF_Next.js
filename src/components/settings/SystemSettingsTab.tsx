/**
 * System Settings Tab
 *
 * Settings container for system module configuration with collapsible sections:
 * - Data Sync feature toggles (Maintenance, Activate, OLT, QField, History)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Settings2,
  ChevronDown,
  Database,
  Wrench,
  Zap,
  AlertTriangle,
  MapPin,
  Clock,
  RefreshCw,
  Loader2,
  Check,
  X,
} from 'lucide-react';
import { log } from '@/lib/logger';

interface FeatureSetting {
  feature_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string;
}

interface Section {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  groupKey: string;
  tabs: { key: string; label: string; description?: string }[];
}

const SECTIONS: Section[] = [
  {
    id: 'maintenance',
    label: 'Maintenance',
    description: 'QContact sync, alignments, and weekly imports',
    icon: Wrench,
    groupKey: 'system.data-sync.maintenance',
    tabs: [
      { key: 'system.data-sync.maintenance.qcontact', label: 'QContact Sync', description: 'QContact ticket synchronization' },
      { key: 'system.data-sync.maintenance.alignment', label: 'QC Alignment', description: 'QContact alignment report' },
      { key: 'system.data-sync.maintenance.three-way', label: '3-Way Alignment', description: 'Three-way alignment report' },
      { key: 'system.data-sync.maintenance.weekly', label: 'Weekly Import', description: 'Weekly report import' },
      { key: 'system.data-sync.maintenance.wa-tracking', label: 'Offline Tracking', description: 'WhatsApp offline tracking' },
    ],
  },
  {
    id: 'activate',
    label: 'Activate',
    description: 'OES/ARCH imports and manual DR entry',
    icon: Zap,
    groupKey: 'system.data-sync.activate',
    tabs: [
      { key: 'system.data-sync.activate.oes', label: 'OES Import', description: 'OES activation import' },
      { key: 'system.data-sync.activate.arch', label: 'ARCH Import', description: 'ARCH offline import' },
      { key: 'system.data-sync.activate.manual', label: 'Manual Entry', description: 'Manual DR entry' },
    ],
  },
  {
    id: 'olt',
    label: 'OLT Report',
    description: 'Nokia OLT report import and 1Map serial fixes',
    icon: AlertTriangle,
    groupKey: 'system.data-sync.olt',
    tabs: [
      { key: 'system.data-sync.olt.import', label: 'Import', description: 'OLT report import' },
      { key: 'system.data-sync.olt.pending', label: 'Fixable', description: 'Pending serial fixes' },
      { key: 'system.data-sync.olt.investigate', label: 'Investigate', description: 'Records needing investigation' },
      { key: 'system.data-sync.olt.escalations', label: 'Escalations', description: 'Escalated issues' },
      { key: 'system.data-sync.olt.history', label: 'History', description: 'Fix history' },
      { key: 'system.data-sync.olt.reporting', label: 'Reporting', description: 'OLT reporting and export' },
    ],
  },
  {
    id: 'qfield',
    label: 'QField',
    description: 'QFieldCloud projects for OES and data sync targets',
    icon: MapPin,
    groupKey: 'system.data-sync.qfield',
    tabs: [
      { key: 'system.data-sync.qfield.projects', label: 'Projects', description: 'QFieldCloud projects management' },
    ],
  },
  {
    id: 'history',
    label: 'History',
    description: 'Unified timeline of all sync and import operations',
    icon: Clock,
    groupKey: 'system.data-sync.history',
    tabs: [
      { key: 'system.data-sync.history.timeline', label: 'Timeline', description: 'Unified sync timeline' },
    ],
  },
];

export function SystemSettingsTab() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['maintenance'])
  );
  const [features, setFeatures] = useState<Map<string, FeatureSetting>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchFeatures = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/system/features');
      if (!res.ok) throw new Error('Failed to fetch features');
      const data = await res.json();
      if (data.success) {
        const map = new Map<string, FeatureSetting>();
        for (const feature of data.data) {
          map.set(feature.feature_key, feature);
        }
        setFeatures(map);
        setError(null);
      } else {
        throw new Error(data.error?.message || 'Failed to fetch features');
      }
    } catch (err) {
      log.error('SystemSettingsTab', 'Failed to fetch features', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch features');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const handleToggle = async (featureKey: string, enabled: boolean) => {
    setSavingKeys((prev) => new Set(prev).add(featureKey));
    setError(null);

    try {
      const res = await fetch('/api/settings/system/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_key: featureKey, enabled }),
      });

      if (!res.ok) throw new Error('Failed to update feature');
      const data = await res.json();

      if (data.success) {
        setFeatures((prev) => {
          const next = new Map(prev);
          const existing = next.get(featureKey);
          if (existing) {
            next.set(featureKey, { ...existing, enabled });
          } else {
            next.set(featureKey, {
              feature_key: featureKey,
              enabled,
              config: {},
              updated_at: new Date().toISOString(),
            });
          }
          return next;
        });
        setLastSaved(featureKey);
        setTimeout(() => setLastSaved(null), 2000);
      } else {
        throw new Error(data.error?.message || 'Failed to update feature');
      }
    } catch (err) {
      log.error('SystemSettingsTab', 'Failed to toggle feature', err);
      setError(err instanceof Error ? err.message : 'Failed to update feature');
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(featureKey);
        return next;
      });
    }
  };

  const isFeatureEnabled = (key: string): boolean => {
    const feature = features.get(key);
    return feature?.enabled ?? true; // Default to enabled if not found
  };

  const handleRefresh = () => {
    setIsLoading(true);
    fetchFeatures();
  };

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Settings2 className="w-5 h-5 text-[var(--ff-primary-400)]" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              System Settings
            </h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Configure system features and data sync options
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="p-2 rounded-lg text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors disabled:opacity-50"
          title="Refresh settings"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          <X className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && features.size === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
          <span className="ml-2 text-[var(--ff-text-secondary)]">Loading settings...</span>
        </div>
      )}

      {/* Data Sync Section Header */}
      {!isLoading && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[var(--ff-primary-500)]/10">
              <Database className="w-4 h-4 text-[var(--ff-primary-400)]" />
            </div>
            <div>
              <h4 className="font-medium text-[var(--ff-text-primary)]">Data Sync Features</h4>
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Enable or disable Data Sync groups and individual tabs
              </p>
            </div>
          </div>

          {/* Collapsible Sections */}
          <div className="space-y-3">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isExpanded = expandedSections.has(section.id);
              const groupEnabled = isFeatureEnabled(section.groupKey);
              const isSavingGroup = savingKeys.has(section.groupKey);
              const justSavedGroup = lastSaved === section.groupKey;

              return (
                <div
                  key={section.id}
                  className="bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden"
                >
                  {/* Section Header with Group Toggle */}
                  <div className="flex items-center justify-between p-4">
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      <div className="p-2 rounded-lg bg-[var(--ff-bg-secondary)]">
                        <Icon className="w-4 h-4 text-[var(--ff-text-primary)]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="font-medium text-[var(--ff-text-primary)]">
                            {section.label}
                          </h5>
                          {justSavedGroup && (
                            <Check className="w-3 h-3 text-green-400" />
                          )}
                        </div>
                        <p className="text-xs text-[var(--ff-text-secondary)]">
                          {section.description}
                        </p>
                      </div>
                      <ChevronDown
                        className={`w-5 h-5 text-[var(--ff-text-secondary)] transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {/* Group Toggle */}
                    <button
                      onClick={() => handleToggle(section.groupKey, !groupEnabled)}
                      disabled={isSavingGroup}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ml-4 ${
                        groupEnabled ? 'bg-[var(--ff-accent)]' : 'bg-[var(--ff-bg-secondary)]'
                      } ${isSavingGroup ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      title={groupEnabled ? 'Disable entire group' : 'Enable entire group'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          groupEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Individual Tab Toggles */}
                  {isExpanded && (
                    <div className="border-t border-[var(--ff-border-light)] divide-y divide-[var(--ff-border-light)]">
                      {section.tabs.map((tab) => {
                        const tabEnabled = isFeatureEnabled(tab.key);
                        const isSavingTab = savingKeys.has(tab.key);
                        const justSavedTab = lastSaved === tab.key;

                        return (
                          <div
                            key={tab.key}
                            className={`flex items-center justify-between py-3 px-4 ${
                              !groupEnabled ? 'opacity-50' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-[var(--ff-text-primary)]">
                                {tab.label}
                              </span>
                              {justSavedTab && (
                                <Check className="w-3 h-3 text-green-400" />
                              )}
                              {tab.description && (
                                <span className="text-xs text-[var(--ff-text-tertiary)]">
                                  — {tab.description}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => handleToggle(tab.key, !tabEnabled)}
                              disabled={isSavingTab || !groupEnabled}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                tabEnabled && groupEnabled
                                  ? 'bg-[var(--ff-accent)]'
                                  : 'bg-[var(--ff-bg-secondary)]'
                              } ${
                                isSavingTab || !groupEnabled
                                  ? 'opacity-50 cursor-not-allowed'
                                  : 'cursor-pointer'
                              }`}
                            >
                              <span
                                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                  tabEnabled && groupEnabled ? 'translate-x-5' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="text-xs text-[var(--ff-text-tertiary)] p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
        <p>
          <strong>Note:</strong> Disabling a group will hide the entire section from the Data Sync
          page. Individual tabs can be toggled within each group for more granular control.
          Role-based permissions in Access Control take precedence over these settings.
        </p>
      </div>
    </div>
  );
}
