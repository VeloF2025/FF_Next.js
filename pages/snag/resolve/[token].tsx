/**
 * Public Snag Resolve Page — No auth required
 *
 * Subcontractors access this via a shared link to:
 * - View the snag details and before photo
 * - Click "Start Work" when ticket is assigned to them
 * - Complete verification steps and upload after photos
 * - Submit for QA when done
 *
 * The page is read-only when the ticket is not in assigned/in_progress status.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  AlertTriangle, CheckCircle, Circle, Camera, ArrowRight,
  Lock, Clock, Upload, User,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SharedTicket {
  id: string;
  ticket_uid: string;
  status: string;
  title: string;
  description: string;
  priority: string;
  assigned_to_name: string | null;
  project_name: string | null;
}

interface SlotPhoto {
  id: string;
  step_id: string;
  slot_key: string;
  slot_label: string;
  source_mode: 'camera' | 'gallery' | 'either';
  is_required: boolean;
  photo_url: string | null;
  uploaded_by_actor_id: string | null;
  uploaded_at: string | null;
}

interface VerificationStep {
  id: string;
  step_number: number;
  step_name: string;
  step_description: string;
  is_complete: boolean;
  completed_at: string | null;
  photo_required: boolean;
  photo_url: string | null;
  notes: string | null;
  /** Slot rows from maintenance_step_photos (empty array for legacy single-photo steps). */
  photo_slots: SlotPhoto[];
}

interface SharedData {
  ticket: SharedTicket;
  canInteract: boolean;
  canStartWork: boolean;
  canSubmit: boolean;
  steps: VerificationStep[];
  beforePhotos: Array<{ photo_url: string; thumbnail_url: string | null; phase: string }>;
  attachments: Array<{ id: string; filename: string; storage_url: string }>;
}

interface SessionActor {
  id: string;
  name: string;
  phone: string;
  company: string | null;
}

const ACTOR_STORAGE_KEY = 'ff-resolve-actor';
const FINGERPRINT_STORAGE_KEY = 'ff-resolve-fingerprint';

/**
 * Browser fingerprint is intentionally **device-scoped, not token-scoped** —
 * the same browser produces the same fingerprint across all share links it
 * opens. That keeps the (token_hash, fingerprint) dedup key stable for a
 * single technician working through multiple tickets on one device.
 */
function getOrCreateFingerprint(): string {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.localStorage.setItem(FINGERPRINT_STORAGE_KEY, fresh);
  return fresh;
}

function loadStoredActor(token: string): SessionActor | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`${ACTOR_STORAGE_KEY}:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionActor;
  } catch {
    // Tampered or stale storage — drop it and force re-identify on next action.
    window.localStorage.removeItem(`${ACTOR_STORAGE_KEY}:${token}`);
    return null;
  }
}

function persistActor(token: string, actor: SessionActor): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${ACTOR_STORAGE_KEY}:${token}`, JSON.stringify(actor));
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress',
  pending_qa: 'Submitted for QA', resolved: 'Resolved',
  verified: 'Verified', closed: 'Closed', cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  pending_qa: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  resolved: 'bg-green-500/20 text-green-400 border-green-500/30',
  verified: 'bg-green-500/20 text-green-400 border-green-500/30',
  closed: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function SnagResolvePage() {
  const router = useRouter();
  const { token } = router.query;

  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [uploadingStep, setUploadingStep] = useState<string | null>(null);
  const [actor, setActor] = useState<SessionActor | null>(null);
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [identityForm, setIdentityForm] = useState({ name: '', phone: '', company: '' });

  const tokenStr = typeof token === 'string' ? token : null;

  // Hydrate stored actor on mount (per token).
  useEffect(() => {
    if (!tokenStr) return;
    const stored = loadStoredActor(tokenStr);
    if (stored) setActor(stored);
  }, [tokenStr]);

  const fetchData = useCallback(async () => {
    if (!token || typeof token !== 'string') return;
    try {
      const res = await fetch(`/api/snags/shared/${token}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `Error ${res.status}`);
      }
      const json = await res.json();
      setData(json.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const performAction = async (action: string, extra?: Record<string, string>) => {
    if (!token) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/snags/shared/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, actorId: actor?.id, ...extra }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? 'Action failed');
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePhotoUpload = async (stepId: string, file: File, slotKey?: string) => {
    if (!token || !data) return;
    if (!actor) {
      setShowIdentityModal(true);
      return;
    }
    // Slot-aware uploads use a stepId+slotKey compound key so concurrent
    // tile uploads on different slots can run in parallel without clobbering
    // each other's spinners. Legacy single-photo steps key on stepId only.
    const uploadKey = slotKey ? `${stepId}:${slotKey}` : stepId;
    setUploadingStep(uploadKey);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'upload_photo');
      formData.append('stepId', stepId);
      if (slotKey) formData.append('slotKey', slotKey);
      if (actor?.id) formData.append('actorId', actor.id);

      const res = await fetch(`/api/snags/shared/${token}`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingStep(null);
    }
  };

  const registerActor = async (): Promise<SessionActor | null> => {
    if (!tokenStr) return null;
    const trimmedName = identityForm.name.trim();
    const trimmedPhone = identityForm.phone.trim();
    if (!trimmedName || !trimmedPhone) {
      setError('Name and WhatsApp number are required.');
      return null;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/snags/shared/${tokenStr}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register_actor',
          name: trimmedName,
          phone: trimmedPhone,
          company: identityForm.company.trim() || undefined,
          browserFingerprint: getOrCreateFingerprint(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? 'Register failed');
      }
      const json = await res.json();
      const registered = json.data?.actor as SessionActor | undefined;
      if (!registered) throw new Error('Register failed');
      setActor(registered);
      persistActor(tokenStr, registered);
      setError(null);
      return registered;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Register failed');
      return null;
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartWork = async () => {
    if (!actor) {
      setShowIdentityModal(true);
      return;
    }
    void performAction('start_work');
  };

  const handleIdentitySubmit = async () => {
    const registered = await registerActor();
    if (!registered) return;
    setShowIdentityModal(false);
    if (data?.canStartWork) {
      void performAction('start_work');
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 border-2 border-zinc-500 border-t-blue-400 rounded-full animate-spin" />
        </div>
      </PageShell>
    );
  }

  if (error && !data) {
    return (
      <PageShell>
        <div className="text-center py-16">
          <Lock className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-zinc-200 mb-2">Link Not Found</h2>
          <p className="text-sm text-zinc-400">{error}</p>
        </div>
      </PageShell>
    );
  }

  if (!data) return null;

  const { ticket, canInteract, canStartWork, canSubmit, steps, beforePhotos } = data;
  const completedSteps = steps.filter((s) => s.is_complete).length;
  const progressPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;

  return (
    <PageShell>
      <Head>
        <title>{ticket.ticket_uid} — Ticket Resolution | FibreFlow</title>
      </Head>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-zinc-100">{ticket.ticket_uid}</h1>
          <span className={`text-xs px-2 py-1 rounded border font-medium ${STATUS_COLORS[ticket.status] ?? STATUS_COLORS.closed}`}>
            {STATUS_LABELS[ticket.status] ?? ticket.status}
          </span>
        </div>
        <h2 className="text-sm text-zinc-300 mb-1">{ticket.title}</h2>
        {ticket.project_name && (
          <p className="text-xs text-zinc-500">Project: {ticket.project_name}</p>
        )}
        {actor && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-800/60 border border-zinc-700 rounded px-2 py-1">
            <User className="w-3 h-3" />
            <span>Logged in as <span className="text-zinc-200">{actor.name}</span>{actor.company ? ` · ${actor.company}` : ''}</span>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-md bg-red-900/20 border border-red-700/40 px-4 py-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Read-only banner */}
      {!canInteract && (
        <div className="mb-6 rounded-lg bg-zinc-800 border border-zinc-700 p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 text-zinc-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {ticket.status === 'pending_qa' ? 'Submitted for QA — awaiting review' :
               ticket.status === 'resolved' || ticket.status === 'verified' || ticket.status === 'closed' ? 'This snag has been resolved' :
               'This ticket is currently read-only'}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {ticket.status === 'pending_qa' ? 'You will regain access if the QA review sends it back for rework.' :
               'Contact the project team if you need to make changes.'}
            </p>
          </div>
        </div>
      )}

      {/* Start Work CTA */}
      {canStartWork && (
        <div className="mb-6 rounded-lg bg-blue-900/20 border border-blue-700/40 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-blue-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-zinc-100 mb-2">Ready to Start?</h3>
          <p className="text-sm text-zinc-300 mb-4 max-w-md mx-auto">
            Review the snag details and before photo below, then click to begin work.
            You&apos;ll be able to complete verification steps and upload photos.
          </p>
          <button
            type="button"
            onClick={() => { void handleStartWork(); }}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            {actionLoading ? 'Starting...' : 'Start Work'}
          </button>
        </div>
      )}

      {/* Description + Before Photo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Snag Description</h3>
          <DescriptionWithGPS text={ticket.description} />
        </div>

        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-red-400 mb-3">Before Photo</h3>
          {beforePhotos.length > 0 ? (
            <a href={beforePhotos[0]?.photo_url} target="_blank" rel="noopener noreferrer">
              <img
                src={beforePhotos[0]?.thumbnail_url ?? beforePhotos[0]?.photo_url}
                alt="Before"
                className="w-full h-48 object-cover rounded-lg border-2 border-red-500/30"
              />
            </a>
          ) : (
            <div className="h-48 rounded-lg border-2 border-dashed border-zinc-600 flex items-center justify-center">
              <span className="text-xs text-zinc-500">No before photo available</span>
            </div>
          )}
        </div>
      </div>

      {/* Verification Steps */}
      {steps.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-200">Verification Steps</h3>
            <span className="text-xs text-zinc-400">{completedSteps}/{steps.length} completed ({progressPct}%)</span>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-zinc-800 rounded-full mb-4 overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>

          <div className="space-y-3">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`rounded-lg border p-4 transition-colors ${
                  step.is_complete
                    ? 'bg-green-900/10 border-green-700/30'
                    : 'bg-zinc-800/50 border-zinc-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {step.is_complete ? (
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    ) : (
                      <Circle className="w-5 h-5 text-zinc-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-zinc-200">
                        {step.step_number}. {step.step_name}
                      </span>
                      {step.photo_required && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 border border-orange-700/30">
                          Photo Required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mb-2">{step.step_description}</p>

                    {/* Slot-aware step: render one tile per declared slot */}
                    {step.photo_slots.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                        {step.photo_slots.map((slot) => {
                          const slotUploadKey = `${step.id}:${slot.slot_key}`;
                          const isUploading = uploadingStep === slotUploadKey;
                          const canUpload = canInteract && ticket.status === 'in_progress';
                          // Camera mode forces live capture (no gallery picker).
                          // Gallery mode (e.g. 1Map sign-up screenshot) leaves
                          // capture unset so the user picks from photos.
                          const captureAttr = slot.source_mode === 'camera' ? 'environment' : undefined;
                          return (
                            <div
                              key={slot.slot_key}
                              className={`rounded border p-2 text-[11px] ${
                                slot.photo_url
                                  ? 'bg-green-900/10 border-green-700/30'
                                  : slot.is_required
                                  ? 'bg-zinc-900/40 border-zinc-700'
                                  : 'bg-zinc-900/20 border-zinc-800'
                              }`}
                            >
                              <div className="flex items-center gap-1 mb-1">
                                <span className="font-medium text-zinc-200 truncate">{slot.slot_label}</span>
                                {slot.is_required && !slot.photo_url && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-orange-900/40 text-orange-300">
                                    Required
                                  </span>
                                )}
                              </div>
                              {slot.photo_url ? (
                                <a href={slot.photo_url} target="_blank" rel="noopener noreferrer" className="block">
                                  <img
                                    src={slot.photo_url}
                                    alt={slot.slot_label}
                                    className="w-full h-20 object-cover rounded"
                                  />
                                </a>
                              ) : (
                                <div className="w-full h-20 rounded bg-zinc-800/60 flex items-center justify-center text-zinc-500">
                                  <Camera className="w-4 h-4" />
                                </div>
                              )}
                              {canUpload && (
                                <label className="inline-flex items-center gap-1 mt-1.5 px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white text-[10px] font-medium rounded cursor-pointer transition-colors w-full justify-center">
                                  <Upload className="w-3 h-3" />
                                  {isUploading
                                    ? 'Uploading...'
                                    : slot.photo_url
                                    ? 'Replace'
                                    : slot.source_mode === 'gallery'
                                    ? 'Upload'
                                    : 'Take photo'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    {...(captureAttr ? { capture: captureAttr } : {})}
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) void handlePhotoUpload(step.id, file, slot.slot_key);
                                    }}
                                    disabled={isUploading}
                                  />
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Legacy single-photo / mark-complete UI — only when the step has no slots */}
                    {step.photo_slots.length === 0 && canInteract && ticket.status === 'in_progress' && !step.is_complete && (
                      <div className="flex items-center gap-2 mt-2">
                        {step.photo_required ? (
                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium rounded cursor-pointer transition-colors">
                            <Camera className="w-3.5 h-3.5" />
                            {uploadingStep === step.id ? 'Uploading...' : 'Upload Photo'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void handlePhotoUpload(step.id, file);
                              }}
                              disabled={uploadingStep === step.id}
                            />
                          </label>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (!actor) { setShowIdentityModal(true); return; }
                              void performAction('complete_step', { stepId: step.id });
                            }}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-xs font-medium rounded transition-colors"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Mark Complete
                          </button>
                        )}
                      </div>
                    )}

                    {step.is_complete && step.completed_at && (
                      <p className="text-[10px] text-green-400/70 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Completed {new Date(step.completed_at).toLocaleDateString('en-ZA')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Identity capture modal */}
      {showIdentityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form
            className="w-full max-w-md rounded-lg bg-zinc-900 border border-zinc-700 p-5"
            onSubmit={(e) => { e.preventDefault(); void handleIdentitySubmit(); }}
          >
            <h3 className="text-base font-semibold text-zinc-100 mb-1">Who are you?</h3>
            <p className="text-xs text-zinc-400 mb-4">
              We need your details before you can start work. Stamped on every photo and step you complete.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-zinc-300">Your name *</span>
                <input
                  type="text"
                  value={identityForm.name}
                  onChange={(e) => setIdentityForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 placeholder:text-zinc-500"
                  placeholder="e.g. Sipho Nkosi"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-300">WhatsApp number *</span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={identityForm.phone}
                  onChange={(e) => setIdentityForm((f) => ({ ...f, phone: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 placeholder:text-zinc-500"
                  placeholder="e.g. 082 123 4567"
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-300">Company (optional)</span>
                <input
                  type="text"
                  value={identityForm.company}
                  onChange={(e) => setIdentityForm((f) => ({ ...f, company: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 placeholder:text-zinc-500"
                  placeholder="e.g. JK Civils"
                />
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowIdentityModal(false)}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm rounded"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading || !identityForm.name.trim() || !identityForm.phone.trim()}
                className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium text-sm rounded"
              >
                {actionLoading ? 'Saving…' : 'Save & Start Work'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Submit for QA */}
      {canSubmit && (
        <div className="rounded-lg bg-green-900/20 border border-green-700/40 p-6 text-center">
          <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-zinc-100 mb-2">Work Complete?</h3>
          <p className="text-sm text-zinc-300 mb-4 max-w-md mx-auto">
            Submit this snag for QA review. Make sure you&apos;ve uploaded the after photo
            and completed all required steps.
          </p>
          <button
            type="button"
            onClick={() => { void performAction('submit_for_qa'); }}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            {actionLoading ? 'Submitting...' : 'Submit for QA'}
          </button>
        </div>
      )}
    </PageShell>
  );
}

// ─── Page Shell (no sidebar, minimal layout) ─────────────────────────────────

/** Renders description text with GPS coordinates as clickable Google Maps links */
function DescriptionWithGPS({ text }: { text: string }) {
  // Match GPS patterns like "GPS: -26.709608,27.02253381" or bare "-26.123,27.456"
  const gpsRegex = /(GPS:\s*)?(-?\d{1,3}\.\d{3,10})\s*[,;]\s*(-?\d{1,3}\.\d{3,10})/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = gpsRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const lat = match[2];
    const lng = match[3];
    const label = match[0]; // Full matched text like "GPS: -26.709608,27.02253381"
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

    parts.push(
      <a
        key={match.index}
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1"
      >
        {label}
        <svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <p className="text-sm text-zinc-200 whitespace-pre-wrap">{parts}</p>;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Minimal header */}
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src="/assets/vf/vf-logo.svg" alt="FibreFlow" className="h-6" />
          <span className="text-sm font-medium text-zinc-300">Snag Resolution</span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-12">
        <div className="max-w-3xl mx-auto px-4 py-4 text-center">
          <p className="text-xs text-zinc-500">
            Powered by FibreFlow — Velocity Fibre (Pty) Ltd
          </p>
        </div>
      </footer>
    </div>
  );
}
