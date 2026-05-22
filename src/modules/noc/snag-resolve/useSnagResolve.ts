/**
 * Hook that owns all data + write-action state for the public snag/resolve page.
 *
 * Exposes `data`, `actor`, `error`, loading flags, plus typed handlers for
 * fetch / register / start work / photo upload / mark complete / submit-for-QA.
 * Keeps the page component focused on layout.
 */

import { useEffect, useState, useCallback } from 'react';
import type { IdentityFormState, ResolveAction, SessionActor, SharedData } from './types';
import { getOrCreateFingerprint, loadStoredActor, persistActor } from './session';

export interface UseSnagResolveResult {
  data: SharedData | null;
  loading: boolean;
  error: string | null;
  actor: SessionActor | null;
  showIdentityModal: boolean;
  identityForm: IdentityFormState;
  actionLoading: boolean;
  uploadingStep: string | null;
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
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('action', 'upload_photo');
      formData.append('stepId', stepId);
      if (slotKey) formData.append('slotKey', slotKey);
      // Keep the conditional from the original page — guards against a server
      // contract drift that yields a falsy actor.id (empty string posts as
      // 'actorId=' rather than the field being absent, which the API handler
      // treats differently downstream).
      if (actor.id) formData.append('actorId', actor.id);
      const res = await fetch(`/api/snags/shared/${tokenStr}`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingStep(null);
    }
  }, [tokenStr, data, actor, fetchData]);

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

  const handleMarkComplete = useCallback((stepId: string) => {
    void performAction('complete_step', { stepId });
  }, [performAction]);

  return {
    data,
    loading,
    error,
    actor,
    showIdentityModal,
    identityForm,
    actionLoading,
    uploadingStep,
    setShowIdentityModal,
    setIdentityForm,
    performAction,
    handlePhotoUpload,
    handleStartWork,
    handleIdentitySubmit,
    handleMarkComplete,
  };
}
