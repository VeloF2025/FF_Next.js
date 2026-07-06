/**
 * Hook that owns all data + write-action state for the public snag/resolve page.
 *
 * Exposes `data`, `actor`, `error`, loading flags, plus typed handlers for
 * fetch / register / start work / photo upload / mark complete / submit-for-QA.
 * Keeps the page component focused on layout.
 */

import { useEffect, useState, useCallback } from 'react';
import { useOfflineQueue, QueueFullError } from '@/lib/offline-queue';
import type { IdentityFormState, QueuedCompleteStep, ResolveAction, SessionActor, SharedData } from './types';
import { getOrCreateFingerprint, loadStoredActor, persistActor } from './session';
import { submitCompleteStep } from './offlineComplete';
import {
  SNAG_PHOTO_MAX_QUEUE_BYTES,
  SNAG_PHOTO_MAX_QUEUE_SIZE,
  snagPhotoQueueName,
  type PendingSnagPhoto,
} from './offline/photoQueue';
import { submitSnagPhoto } from './offline/submitSnagPhoto';
import { submitPhotoWithOfflineFallback } from './offline/submitPhotoWithOfflineFallback';

export interface UseSnagResolveResult {
  data: SharedData | null;
  loading: boolean;
  error: string | null;
  actor: SessionActor | null;
  showIdentityModal: boolean;
  identityForm: IdentityFormState;
  actionLoading: boolean;
  uploadingStep: string | null;
  pendingCompleteCount: number;
  pendingPhotoCount: number;
  /** Emphatic "photo NOT saved" copy (quota/queue full or undecodable image).
   *  Non-null ⇒ the UI must render a hard failure, never a queued/green state. */
  photoNotSaved: string | null;
  clearPhotoNotSaved: () => void;
  setShowIdentityModal: (show: boolean) => void;
  setIdentityForm: (form: IdentityFormState) => void;
  performAction: (action: ResolveAction, extra?: Record<string, string>) => Promise<void>;
  handlePhotoUpload: (stepId: string, file: File, slotKey?: string) => Promise<void>;
  handleStartWork: () => Promise<void>;
  handleIdentitySubmit: () => Promise<void>;
  handleMarkComplete: (stepId: string) => void;
}

export function useSnagResolve(tokenStr: string | null): UseSnagResolveResult {
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [uploadingStep, setUploadingStep] = useState<string | null>(null);
  const [actor, setActor] = useState<SessionActor | null>(null);
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [identityForm, setIdentityForm] = useState<IdentityFormState>({ name: '', phone: '', company: '' });

  const [photoNotSaved, setPhotoNotSaved] = useState<string | null>(null);

  const completeQueue = useOfflineQueue<QueuedCompleteStep>({
    // One DB per token keeps a device that resolves several snags from mixing queues.
    queueName: tokenStr ? `SnagCompleteDB:${tokenStr}` : 'SnagCompleteDB:none',
    submit: submitCompleteStep,
  });
  // Destructure the stable primitives so handleMarkComplete's deps are plain
  // identifiers (satisfies react-hooks/exhaustive-deps and keeps a stable identity).
  const { online: completeOnline, enqueue: enqueueComplete } = completeQueue;

  // Photo queue: byte-aware (photos are large — the count cap alone is unsafe).
  const photoQueue = useOfflineQueue<PendingSnagPhoto>({
    queueName: tokenStr ? snagPhotoQueueName(tokenStr) : snagPhotoQueueName('none'),
    submit: submitSnagPhoto,
    maxQueueBytes: SNAG_PHOTO_MAX_QUEUE_BYTES,
    maxQueueSize: SNAG_PHOTO_MAX_QUEUE_SIZE,
    sizeOf: (p) => p.byteSize,
  });
  const { online: photoOnline, enqueue: enqueuePhoto } = photoQueue;
  const clearPhotoNotSaved = useCallback(() => setPhotoNotSaved(null), []);

  useEffect(() => {
    if (!tokenStr) return;
    const stored = loadStoredActor(tokenStr);
    if (stored) setActor(stored);
  }, [tokenStr]);

  const fetchData = useCallback(async () => {
    if (!tokenStr) return;
    try {
      const res = await fetch(`/api/snags/shared/${tokenStr}`);
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
  }, [tokenStr]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const performAction = useCallback(async (action: ResolveAction, extra?: Record<string, string>) => {
    if (!tokenStr) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/snags/shared/${tokenStr}`, {
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
  }, [tokenStr, actor?.id, fetchData]);

  const handlePhotoUpload = useCallback(async (stepId: string, file: File, slotKey?: string) => {
    if (!tokenStr || !data) return;
    if (!actor) { setShowIdentityModal(true); return; }
    // Slot-aware uploads use a stepId+slotKey compound key so concurrent tile
    // uploads run in parallel without clobbering each other's spinners.
    const uploadKey = slotKey ? `${stepId}:${slotKey}` : stepId;
    setUploadingStep(uploadKey);
    setPhotoNotSaved(null);
    // `actor.id` guarded to undefined so a falsy id isn't sent as 'actorId='.
    const result = await submitPhotoWithOfflineFallback(
      { token: tokenStr, stepId, slotKey, actorId: actor.id || undefined, file },
      { online: photoOnline, enqueue: enqueuePhoto }
    );
    setUploadingStep(null);
    switch (result.kind) {
      case 'submitted':
        // Only a server-confirmed upload refreshes the tiles — a queued photo
        // must NOT show as uploaded (no green tile for un-synced work).
        await fetchData();
        return;
      case 'queued':
        // pendingPhotoCount surfaces it; the tile stays in its pre-upload state.
        return;
      case 'not_saved':
        setPhotoNotSaved(result.message);
        return;
      case 'error':
        setError(result.message);
        return;
    }
  }, [tokenStr, data, actor, photoOnline, enqueuePhoto, fetchData]);

  const registerActor = useCallback(async (): Promise<SessionActor | null> => {
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
  }, [tokenStr, identityForm]);

  const handleStartWork = useCallback(async () => {
    if (!actor) { setShowIdentityModal(true); return; }
    await performAction('start_work');
  }, [actor, performAction]);

  const handleIdentitySubmit = useCallback(async () => {
    const registered = await registerActor();
    if (!registered) return;
    setShowIdentityModal(false);
    if (data?.canStartWork) await performAction('start_work');
  }, [registerActor, data?.canStartWork, performAction]);

  const handleMarkComplete = useCallback(
    (stepId: string) => {
      if (!tokenStr) return;
      // Offline: queue for background sync on reconnect (the pilot's core).
      // Online: performAction does the POST and surfaces its own errors.
      if (!completeOnline) {
        const payload: QueuedCompleteStep = { token: tokenStr, stepId, actorId: actor?.id };
        // NEVER let an offline completion vanish silently — surface a queue-full
        // or IndexedDB-unavailable failure so the user knows it was NOT saved.
        enqueueComplete(payload).catch((err) => {
          setError(
            err instanceof QueueFullError
              ? err.message
              : 'Could not save this step offline. Reconnect and try again, or contact support.'
          );
        });
        return;
      }
      void performAction('complete_step', { stepId });
    },
    [tokenStr, actor?.id, completeOnline, enqueueComplete, performAction]
  );

  return {
    data,
    loading,
    error,
    actor,
    showIdentityModal,
    identityForm,
    actionLoading,
    uploadingStep,
    pendingCompleteCount: completeQueue.pendingCount,
    pendingPhotoCount: photoQueue.pendingCount,
    photoNotSaved,
    clearPhotoNotSaved,
    setShowIdentityModal,
    setIdentityForm,
    performAction,
    handlePhotoUpload,
    handleStartWork,
    handleIdentitySubmit,
    handleMarkComplete,
  };
}
