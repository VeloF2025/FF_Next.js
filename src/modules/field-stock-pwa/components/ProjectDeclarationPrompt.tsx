'use client';

/**
 * ProjectDeclarationPrompt — "which project are you on today?"
 *
 * Shown once a day, on entering the portal, to workers whose project we do not
 * already know from today. It exists so the stores flow can offer only the
 * technicians actually on a project instead of all 26 on every handout.
 *
 * Deliberately NOT shown to someone who completed the morning H&S check-in —
 * that already captured a project, and asking twice is how a prompt gets
 * dismissed reflexively. The server decides via lib/currentProject.ts; this
 * component only renders what it is told.
 *
 * Dismissible. A worker who taps "Not now" gets on with their job and is asked
 * again tomorrow: a prompt that cannot be escaped becomes a prompt people learn
 * to click through without reading.
 *
 * The shell renders this on EVERY /my page, so the answer is cached in
 * sessionStorage for the day once it is known. Without that, an office worker
 * who will never be asked still pays a round trip on every payslip and receipt
 * page they open.
 */

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Check, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface ProjectOption {
  id: string;
  name: string;
}

interface ProjectStatus {
  projectId: string | null;
  source: 'checkin-today' | 'declared-today' | 'stale-declaration' | 'none';
  shouldAsk: boolean;
  suggestedProjectName: string | null;
  options: ProjectOption[];
}

/** Session cache key, dated so it naturally expires at midnight. */
function settledKey(): string {
  // SAST day, matching the server's notion of "today".
  const sast = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
  return `my.project.settled.${sast}`;
}

export function ProjectDeclarationPrompt() {
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Already settled today (answered, dismissed, or never applicable) —
        // do not call the server again on every page in the portal.
        if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(settledKey())) return;
        const res = await fetch('/api/my/project', { credentials: 'include' });
        if (!res.ok) return; // Never block the portal on this — it is a nicety.
        const json = (await res.json()) as { success: boolean; data?: ProjectStatus };
        if (!cancelled && json.success && json.data) {
          if (!json.data.shouldAsk && typeof sessionStorage !== 'undefined') {
            // Nothing to ask today: remember, so the rest of the portal is free.
            sessionStorage.setItem(settledKey(), 'not-applicable');
          }
          setStatus(json.data);
          // Pre-select the standing declaration so confirming is one tap.
          setChoice(json.data.projectId ?? '');
        }
      } catch (err) {
        log.warn('project prompt: status fetch failed', { err }, 'ProjectDeclarationPrompt');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = useCallback(async () => {
    if (!choice) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/my/project', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: choice }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(settledKey(), 'answered');
      setDismissed(true);
    } catch (err) {
      log.warn('project prompt: save failed', { err }, 'ProjectDeclarationPrompt');
      setError('Could not save — check your signal and try again.');
    } finally {
      setSaving(false);
    }
  }, [choice]);

  if (!status || !status.shouldAsk || dismissed) return null;

  return (
    <div className="mb-4 rounded-lg border border-sky-800 bg-sky-950/30 p-3">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-300" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">Which project are you on today?</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {status.suggestedProjectName
              ? `We have you on ${status.suggestedProjectName}. Confirm or change it.`
              : 'This makes sure the right stock is issued to you.'}
          </p>

          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Project"
            className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none"
          >
            <option value="">Select a project…</option>
            {status.options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!choice || saving}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-700 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirm
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof sessionStorage !== 'undefined') {
                  sessionStorage.setItem(settledKey(), 'dismissed');
                }
                setDismissed(true);
              }}
              className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
