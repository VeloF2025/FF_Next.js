/**
 * Default Terms & Settings Section
 *
 * Configure default payment terms, delivery terms, currency,
 * tax rate, and workflow rules for procurement.
 */

import { useState, useEffect, useCallback } from 'react';
import { Save, Loader2, AlertCircle } from 'lucide-react';

interface Setting {
  id: string;
  key: string;
  value: unknown;
  category: string;
  label: string;
  description: string;
}

const PAYMENT_TERM_OPTIONS = [
  'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90',
  'COD', 'CIA', '50% Upfront',
];

const DELIVERY_TERM_OPTIONS = [
  'Ex Works', 'FOB', 'CIF', 'DDP', 'DAP', 'FCA',
];

const CURRENCY_OPTIONS = ['ZAR', 'USD', 'EUR', 'GBP'];

export function DefaultTermsSection() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/settings/procurement/terms');
      const json = await res.json();
      if (json.success) {
        setSettings(json.data.settings);
      } else {
        setError(json.error?.message || 'Failed to load');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateSetting = (key: string, value: unknown) => {
    setSettings(prev =>
      prev.map(s => s.key === key ? { ...s, value } : s)
    );
    setIsDirty(true);
  };

  const getSettingValue = (key: string): unknown => {
    return settings.find(s => s.key === key)?.value;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/procurement/terms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: settings.map(s => ({ key: s.key, value: s.value })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setIsDirty(false);
      }
    } catch {
      setError('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--ff-text-secondary)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading settings...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-4 text-red-400">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      {/* General Settings */}
      <div>
        <h5 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">General</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[var(--ff-text-secondary)] block mb-1">Default Currency</label>
            <select
              value={String(getSettingValue('currency') || 'ZAR')}
              onChange={e => updateSetting('currency', e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
            >
              {CURRENCY_OPTIONS.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-[var(--ff-text-secondary)] block mb-1">Default Tax Rate (%)</label>
            <input
              type="number"
              value={Number(getSettingValue('tax_rate') || 15)}
              onChange={e => updateSetting('tax_rate', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
              min={0}
              max={100}
              step={0.5}
            />
          </div>
        </div>
      </div>

      {/* Terms */}
      <div>
        <h5 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">Default Terms</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[var(--ff-text-secondary)] block mb-1">Payment Terms</label>
            <select
              value={String(getSettingValue('payment_terms') || 'Net 30')}
              onChange={e => updateSetting('payment_terms', e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
            >
              {PAYMENT_TERM_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-[var(--ff-text-secondary)] block mb-1">Delivery Terms (Incoterms)</label>
            <select
              value={String(getSettingValue('delivery_terms') || 'Ex Works')}
              onChange={e => updateSetting('delivery_terms', e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
            >
              {DELIVERY_TERM_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Workflow Rules */}
      <div>
        <h5 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">Workflow Rules</h5>
        <div className="space-y-3">
          <label className="flex items-center gap-3 p-3 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(getSettingValue('require_3_quotes'))}
              onChange={e => updateSetting('require_3_quotes', e.target.checked)}
              className="rounded bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]"
            />
            <div>
              <div className="text-sm text-[var(--ff-text-primary)]">Require 3 Quotes</div>
              <div className="text-xs text-[var(--ff-text-secondary)]">
                Require minimum 3 supplier quotes before creating a purchase order
              </div>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(getSettingValue('auto_approve_enabled'))}
              onChange={e => updateSetting('auto_approve_enabled', e.target.checked)}
              className="rounded bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]"
            />
            <div>
              <div className="text-sm text-[var(--ff-text-primary)]">Auto-Approve Low Value</div>
              <div className="text-xs text-[var(--ff-text-secondary)]">
                Automatically approve purchase requests below the configured threshold
              </div>
            </div>
          </label>
        </div>
      </div>

      {isDirty && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-1"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
