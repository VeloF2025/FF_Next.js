/**
 * Risk Assessment Form - Create/edit risk register entry
 */

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { log } from '@/lib/logger';
import {
  RISK_CATEGORIES,
  LIKELIHOOD_SCALE,
  SEVERITY_SCALE,
  RISK_LEVEL_CONFIG,
  type RiskCategory,
  type RiskLevel,
} from '@/modules/health-safety/types/risk.types';

interface RiskFormProps {
  projectId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const inputClass =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-xs font-medium text-[var(--ff-text-secondary)] mb-1';

function getRiskLevel(l: number, s: number): RiskLevel {
  const score = l * s;
  if (score >= 20) return 'extreme';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

export function RiskForm({ projectId, onSuccess, onCancel }: RiskFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; project_name: string }[]>([]);

  const [form, setForm] = useState({
    project_id: projectId || '',
    hazard_description: '',
    risk_category: 'physical' as RiskCategory,
    site_location: '',
    activity_description: '',
    persons_at_risk: '',
    likelihood: 3,
    severity: 3,
    existing_controls: '',
    residual_likelihood: 0,
    residual_severity: 0,
    additional_controls: '',
    review_date: '',
  });

  useEffect(() => {
    fetch('/api/projects', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProjects(d.data || []))
      .catch((err) => log.error('Failed to load projects', err as Error));
  }, []);

  const inherentLevel = getRiskLevel(form.likelihood, form.severity);
  const residualLevel = form.residual_likelihood && form.residual_severity
    ? getRiskLevel(form.residual_likelihood, form.residual_severity)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/health-safety/risks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...form,
          project_id: form.project_id || undefined,
          residual_likelihood: form.residual_likelihood || undefined,
          residual_severity: form.residual_severity || undefined,
          review_date: form.review_date || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create risk');
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create risk');
    } finally {
      setSubmitting(false);
    }
  };

  const set = (field: string, value: string | number) => setForm((p) => ({ ...p, [field]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--ff-bg-primary)] rounded-xl border border-[var(--ff-border-light)] w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">New Risk Assessment</h2>
          <button onClick={onCancel} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="p-2 text-sm text-red-400 bg-red-500/10 rounded-lg border border-red-500/30">{error}</div>}

          {/* Project & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Project</label>
              <select value={form.project_id} onChange={(e) => set('project_id', e.target.value)} className={inputClass}>
                <option value="">— All projects —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.project_name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Category *</label>
              <select value={form.risk_category} onChange={(e) => set('risk_category', e.target.value)} className={inputClass}>
                {Object.entries(RISK_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          {/* Hazard */}
          <div>
            <label className={labelClass}>Hazard Description *</label>
            <textarea value={form.hazard_description} onChange={(e) => set('hazard_description', e.target.value)} required placeholder="Describe the hazard..." rows={2} className={`${inputClass} resize-y`} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Site Location</label>
              <input type="text" value={form.site_location} onChange={(e) => set('site_location', e.target.value)} placeholder="Where?" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Persons at Risk</label>
              <input type="text" value={form.persons_at_risk} onChange={(e) => set('persons_at_risk', e.target.value)} placeholder="Workers, public, etc." className={inputClass} />
            </div>
          </div>

          {/* Inherent Risk */}
          <div className="p-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
            <h4 className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase mb-3">Inherent Risk (before controls)</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Likelihood (1-5) *</label>
                <select value={form.likelihood} onChange={(e) => set('likelihood', parseInt(e.target.value))} className={inputClass}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {LIKELIHOOD_SCALE[n].label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Severity (1-5) *</label>
                <select value={form.severity} onChange={(e) => set('severity', parseInt(e.target.value))} className={inputClass}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {SEVERITY_SCALE[n].label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Risk Score</label>
                <div className={`px-3 py-2 rounded-lg text-sm font-bold text-center ${
                  inherentLevel === 'extreme' ? 'bg-red-500/20 text-red-400' :
                  inherentLevel === 'high' ? 'bg-orange-500/20 text-orange-400' :
                  inherentLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-green-500/20 text-green-400'
                }`}>
                  {form.likelihood * form.severity} — {RISK_LEVEL_CONFIG[inherentLevel].label}
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div>
            <label className={labelClass}>Existing Controls</label>
            <textarea value={form.existing_controls} onChange={(e) => set('existing_controls', e.target.value)} placeholder="What controls are currently in place?" rows={2} className={`${inputClass} resize-y`} />
          </div>

          {/* Residual Risk */}
          <div className="p-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
            <h4 className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase mb-3">Residual Risk (after controls)</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Likelihood</label>
                <select value={form.residual_likelihood} onChange={(e) => set('residual_likelihood', parseInt(e.target.value))} className={inputClass}>
                  <option value="0">— Same —</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {LIKELIHOOD_SCALE[n].label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Severity</label>
                <select value={form.residual_severity} onChange={(e) => set('residual_severity', parseInt(e.target.value))} className={inputClass}>
                  <option value="0">— Same —</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {SEVERITY_SCALE[n].label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Residual Score</label>
                {residualLevel ? (
                  <div className={`px-3 py-2 rounded-lg text-sm font-bold text-center ${
                    residualLevel === 'extreme' ? 'bg-red-500/20 text-red-400' :
                    residualLevel === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    residualLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {(form.residual_likelihood || form.likelihood) * (form.residual_severity || form.severity)} — {RISK_LEVEL_CONFIG[residualLevel].label}
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-lg text-sm text-[var(--ff-text-tertiary)] text-center">Same as inherent</div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Review Date</label>
            <input type="date" value={form.review_date} onChange={(e) => set('review_date', e.target.value)} className={inputClass} />
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-[var(--ff-border-light)]">
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {submitting ? 'Creating...' : 'Add to Register'}
            </button>
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-[var(--ff-text-secondary)]">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
