/**
 * Investigation Panel - Full incident investigation workflow
 *
 * 4-step process: Assign → Root Cause → Findings → CAPAs
 */

import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import {
  UserCheck,
  Search,
  FileText,
  CheckSquare,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { FiveWhysForm, type WhyEntry } from './FiveWhysForm';
import { CAPA_SEVERITY_CONFIG, type CAPASeverity } from '@/modules/health-safety/types/capa.types';

interface InvestigationPanelProps {
  ticketId: string;
  onComplete?: () => void;
}

interface CAPADraft {
  title: string;
  description: string;
  severity: CAPASeverity;
  due_date: string;
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

const inputClass =
  'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-xs font-medium text-[var(--ff-text-secondary)] mb-1';

const STEPS = [
  { id: 'assign', label: 'Assign', icon: UserCheck },
  { id: 'root-cause', label: 'Root Cause', icon: Search },
  { id: 'findings', label: 'Findings', icon: FileText },
  { id: 'actions', label: 'Actions', icon: CheckSquare },
];

export function InvestigationPanel({ ticketId, onComplete }: InvestigationPanelProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  // Investigation state
  const [investigator, setInvestigator] = useState('');
  const [rootCauseMethod, setRootCauseMethod] = useState<string>('five_whys');
  const [whyEntries, setWhyEntries] = useState<WhyEntry[]>([]);
  const [rootCause, setRootCause] = useState('');
  const [contributingFactors, setContributingFactors] = useState<string[]>([]);
  const [findings, setFindings] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [capaDrafts, setCapaDrafts] = useState<CAPADraft[]>([]);

  const { data, mutate } = useSWR(
    `/api/health-safety/tickets/${ticketId}/investigate`,
    fetcher
  );

  const details = data?.data?.details;
  const existingCapas = data?.data?.capas || [];

  // Load users
  useEffect(() => {
    fetch('/api/users?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setUsers(d.data || d.users || []))
      .catch((err) => log.error('Failed to load users', err as Error));
  }, []);

  // Hydrate from existing data
  useEffect(() => {
    if (!details) return;
    if (details.investigated_by) setInvestigator(details.investigated_by);
    if (details.root_cause) setRootCause(details.root_cause);
    if (details.root_cause_method) setRootCauseMethod(details.root_cause_method);
    if (details.root_cause_analysis?.length) setWhyEntries(details.root_cause_analysis);
    if (details.contributing_factors?.length) setContributingFactors(details.contributing_factors);
    if (details.investigation_findings) setFindings(details.investigation_findings);
    if (details.investigation_recommendations) setRecommendations(details.investigation_recommendations);

    // Auto-advance step based on existing data
    if (details.investigation_status === 'completed') setStep(3);
    else if (details.investigation_findings) setStep(2);
    else if (details.root_cause || details.root_cause_analysis?.length) setStep(1);
    else if (details.investigated_by) setStep(1);
  }, [details]);

  const handleAssign = async () => {
    setSaving(true);
    try {
      await fetch(`/api/health-safety/tickets/${ticketId}/investigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ investigated_by: investigator || undefined }),
      });
      mutate();
      setStep(1);
    } catch (err) {
      log.error('Failed to assign investigator', err as Error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFindings = async (complete = false) => {
    setSaving(true);
    try {
      await fetch(`/api/health-safety/tickets/${ticketId}/investigate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          root_cause: rootCause || (whyEntries.length > 0 ? whyEntries[whyEntries.length - 1].answer : undefined),
          root_cause_method: rootCauseMethod,
          root_cause_analysis: whyEntries,
          contributing_factors: contributingFactors.filter(Boolean),
          investigation_findings: findings,
          investigation_recommendations: recommendations,
          complete,
          capa_items: complete ? capaDrafts.filter((c) => c.title.trim()) : undefined,
        }),
      });
      mutate();
      if (complete) onComplete?.();
    } catch (err) {
      log.error('Failed to save investigation', err as Error);
    } finally {
      setSaving(false);
    }
  };

  const addCapaDraft = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    setCapaDrafts([...capaDrafts, {
      title: '',
      description: '',
      severity: 'medium',
      due_date: d.toISOString().split('T')[0],
    }]);
  };

  const updateCapaDraft = (idx: number, field: keyof CAPADraft, value: string) => {
    setCapaDrafts(capaDrafts.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  const removeCapaDraft = (idx: number) => {
    setCapaDrafts(capaDrafts.filter((_, i) => i !== idx));
  };

  const addFactor = () => setContributingFactors([...contributingFactors, '']);

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          const isActive = idx === step;
          const isDone = idx < step;
          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                onClick={() => idx <= step && setStep(idx)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--ff-primary-500)] text-white'
                    : isDone
                      ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                      : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {s.label}
              </button>
              {idx < STEPS.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Step 0: Assign */}
      {step === 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
            Assign Investigator
          </h3>
          <div>
            <label htmlFor="investigator" className={labelClass}>Investigator</label>
            <select
              id="investigator"
              value={investigator}
              onChange={(e) => setInvestigator(e.target.value)}
              className={inputClass}
            >
              <option value="">— Self (current user) —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAssign}
            disabled={saving}
            className="px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {saving ? 'Assigning...' : 'Start Investigation'}
          </button>
        </div>
      )}

      {/* Step 1: Root Cause */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
            Root Cause Analysis
          </h3>

          <div>
            <label className={labelClass}>Method</label>
            <select
              value={rootCauseMethod}
              onChange={(e) => setRootCauseMethod(e.target.value)}
              className={inputClass}
            >
              <option value="five_whys">5-Whys</option>
              <option value="fishbone">Fishbone (Ishikawa)</option>
              <option value="fault_tree">Fault Tree</option>
              <option value="other">Other / Narrative</option>
            </select>
          </div>

          {rootCauseMethod === 'five_whys' && (
            <FiveWhysForm entries={whyEntries} onChange={setWhyEntries} />
          )}

          {rootCauseMethod !== 'five_whys' && (
            <div>
              <label className={labelClass}>Root Cause Description</label>
              <textarea
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                placeholder="Describe the root cause..."
                rows={4}
                className={`${inputClass} resize-y`}
              />
            </div>
          )}

          {/* Contributing factors */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass}>Contributing Factors</label>
              <button type="button" onClick={addFactor} className="text-xs text-[var(--ff-primary-500)]">
                <Plus className="w-3 h-3 inline" /> Add
              </button>
            </div>
            {contributingFactors.map((f, idx) => (
              <div key={idx} className="flex gap-2 mb-1">
                <input
                  type="text"
                  value={f}
                  onChange={(e) => {
                    const updated = [...contributingFactors];
                    updated[idx] = e.target.value;
                    setContributingFactors(updated);
                  }}
                  placeholder={`Factor ${idx + 1}`}
                  className={`${inputClass} flex-1`}
                />
                <button type="button" onClick={() => setContributingFactors(contributingFactors.filter((_, i) => i !== idx))} className="text-red-400 p-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={() => { handleSaveFindings(); setStep(2); }} disabled={saving} className="px-4 py-2 bg-[var(--ff-primary-500)] text-white text-sm rounded-lg disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save & Continue'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Findings */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
            Investigation Findings
          </h3>
          <div>
            <label className={labelClass}>Findings</label>
            <textarea
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder="Document investigation findings..."
              rows={4}
              className={`${inputClass} resize-y`}
            />
          </div>
          <div>
            <label className={labelClass}>Recommendations</label>
            <textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              placeholder="Recommend corrective and preventive measures..."
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>
          <button onClick={() => { handleSaveFindings(); setStep(3); }} disabled={saving} className="px-4 py-2 bg-[var(--ff-primary-500)] text-white text-sm rounded-lg disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save & Continue'}
          </button>
        </div>
      )}

      {/* Step 3: Create CAPAs */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
              Corrective Actions
            </h3>
            <button type="button" onClick={addCapaDraft} className="flex items-center gap-1 text-xs text-[var(--ff-primary-500)]">
              <Plus className="w-3.5 h-3.5" /> Add CAPA
            </button>
          </div>

          {/* Existing CAPAs */}
          {existingCapas.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-[var(--ff-text-tertiary)]">Existing CAPAs:</p>
              {existingCapas.map((c: any) => (
                <div key={c.id} className="p-2 rounded bg-[var(--ff-bg-tertiary)] text-sm flex justify-between">
                  <span className="text-[var(--ff-text-primary)]">{c.title}</span>
                  <span className="text-xs text-[var(--ff-text-tertiary)]">{c.status}</span>
                </div>
              ))}
            </div>
          )}

          {/* CAPA drafts */}
          {capaDrafts.map((draft, idx) => (
            <div key={idx} className="p-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--ff-text-secondary)]">CAPA {idx + 1}</span>
                <button type="button" onClick={() => removeCapaDraft(idx)} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <input type="text" value={draft.title} onChange={(e) => updateCapaDraft(idx, 'title', e.target.value)} placeholder="Action required..." className={inputClass} />
              <div className="grid grid-cols-2 gap-2">
                <select value={draft.severity} onChange={(e) => updateCapaDraft(idx, 'severity', e.target.value)} className={inputClass}>
                  {Object.entries(CAPA_SEVERITY_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <input type="date" value={draft.due_date} onChange={(e) => updateCapaDraft(idx, 'due_date', e.target.value)} className={inputClass} />
              </div>
            </div>
          ))}

          {capaDrafts.length === 0 && existingCapas.length === 0 && (
            <p className="text-sm text-[var(--ff-text-tertiary)] italic">
              No corrective actions yet. Click &quot;Add CAPA&quot; to create from findings.
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => handleSaveFindings(true)}
              disabled={saving}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Complete Investigation'}
            </button>
            <button
              onClick={() => handleSaveFindings(false)}
              disabled={saving}
              className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Save Draft
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
