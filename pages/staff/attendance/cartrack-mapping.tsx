/**
 * /staff/attendance/cartrack-mapping — HR/Admin one-time mapping page.
 *
 * Lists active fleet_vehicles with their current cartrack_vehicle_id, and
 * (on demand) pulls Cartrack's vehicle list to suggest candidates by
 * registration. Admin picks a Cartrack ID per vehicle (or clears it).
 *
 * Not a rich datagrid by design — mapping is a low-frequency admin task
 * (once per fleet change). Plain table + a dropdown keeps the surface
 * small and reviewable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Link2, Save, X } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface FleetVehicle {
  id: string;
  registration: string | null;
  description: string | null;
  cartrack_vehicle_id: string | null;
}

interface Candidate {
  cartrackId: string;
  registration: string | null;
  description: string | null;
}

function parseApiError(body: unknown, status: number): string {
  const e = (body as { error?: { message?: string } | string } | null)?.error;
  if (typeof e === 'string') return e;
  return e?.message ?? `HTTP ${status}`;
}

function normalisePlate(s: string | null): string {
  return (s ?? '').replace(/\s+/g, '').toUpperCase();
}

export default function CartrackMappingPage() {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async (withCandidates: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/attendance-cartrack-mapping${withCandidates ? '?include_candidates=true' : ''}`,
        { credentials: 'same-origin' }
      );
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch (parseErr) {
          log.warn('[cartrack-mapping] non-JSON error body', {
            status: res.status,
            err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
        throw new Error(parseApiError(body, res.status));
      }
      const body = (await res.json()) as {
        success: true;
        data: {
          vehicles: FleetVehicle[];
          candidates: Candidate[];
          candidatesError: string | null;
        };
      };
      setVehicles(body.data.vehicles);
      setCandidates(body.data.candidates);
      setCandidatesError(body.data.candidatesError);
      setDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      log.error('[cartrack-mapping] load failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const candidatesByPlate = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const key = normalisePlate(c.registration);
      if (!key) continue;
      const bucket = m.get(key) ?? [];
      bucket.push(c);
      m.set(key, bucket);
    }
    return m;
  }, [candidates]);

  async function save(fleetVehicleId: string) {
    const value = draft[fleetVehicleId];
    if (value === undefined) return;
    const cartrackVehicleId = value.trim().length > 0 ? value.trim() : null;
    setBusy(fleetVehicleId);
    setError(null);
    try {
      const res = await fetch('/api/staff/attendance-cartrack-mapping', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fleet_vehicle_id: fleetVehicleId,
          cartrack_vehicle_id: cartrackVehicleId,
        }),
      });
      if (!res.ok) {
        let body: unknown = {};
        try {
          body = await res.json();
        } catch (parseErr) {
          log.warn('[cartrack-mapping] non-JSON save body', {
            status: res.status,
            err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
        throw new Error(parseApiError(body, res.status));
      }
      const body = (await res.json()) as { data: { vehicle: FleetVehicle } };
      setVehicles((prev) =>
        prev.map((v) => (v.id === fleetVehicleId ? body.data.vehicle : v))
      );
      setDraft((prev) => {
        const next = { ...prev };
        delete next[fleetVehicleId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      log.error('[cartrack-mapping] save failed', {
        fleetVehicleId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppLayout>
      <AttendanceNav />
      <div className="p-6 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Cartrack Mapping</h1>
            <p className="text-sm text-neutral-400">
              Link each fleet vehicle to its Cartrack vehicle ID for GPS cross-checks.
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => load(true)}
            className="px-3 py-1 rounded border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-sm flex items-center gap-2"
          >
            <Link2 className="w-4 h-4" />
            Load Cartrack candidates
          </button>
        </header>

        {error && (
          <div className="rounded border border-red-800 bg-red-950/30 p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>{error}</div>
          </div>
        )}
        {candidatesError && (
          <div className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>Candidate fetch failed: {candidatesError}</div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400 text-sm">
            <LoadingSpinner /> Loading…
          </div>
        )}

        {!loading && (
          <div className="overflow-x-auto border border-neutral-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-300">
                <tr>
                  <th className="text-left px-3 py-2">Registration</th>
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-left px-3 py-2">Current Cartrack ID</th>
                  <th className="text-left px-3 py-2">Candidates (by plate)</th>
                  <th className="text-left px-3 py-2">New Cartrack ID</th>
                  <th className="text-left px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => {
                  const suggestions = candidatesByPlate.get(normalisePlate(v.registration)) ?? [];
                  const draftValue = draft[v.id];
                  return (
                    <tr key={v.id} className="border-t border-neutral-800 align-top">
                      <td className="px-3 py-2 font-medium">{v.registration ?? '—'}</td>
                      <td className="px-3 py-2 text-neutral-400">{v.description ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-mono">
                        {v.cartrack_vehicle_id ?? <span className="text-neutral-500">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {suggestions.length === 0 ? (
                          <span className="text-xs text-neutral-500">(none)</span>
                        ) : (
                          <ul className="text-xs space-y-1">
                            {suggestions.map((c) => (
                              <li key={c.cartrackId}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft((prev) => ({ ...prev, [v.id]: c.cartrackId }))
                                  }
                                  className="font-mono text-emerald-400 hover:underline"
                                >
                                  {c.cartrackId}
                                </button>
                                {c.description && (
                                  <span className="text-neutral-500"> · {c.description}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={draftValue ?? v.cartrack_vehicle_id ?? ''}
                          placeholder="Cartrack ID or blank to clear"
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, [v.id]: e.target.value }))
                          }
                          className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs font-mono w-40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={busy === v.id || draftValue === undefined}
                            onClick={() => save(v.id)}
                            className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800/60 disabled:opacity-50 text-xs flex items-center gap-1"
                          >
                            <Save className="w-3 h-3" /> Save
                          </button>
                          <button
                            type="button"
                            disabled={busy === v.id || draftValue === undefined}
                            onClick={() =>
                              setDraft((prev) => {
                                const next = { ...prev };
                                delete next[v.id];
                                return next;
                              })
                            }
                            className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 disabled:opacity-50 text-xs flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
