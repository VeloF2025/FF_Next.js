import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CommandMeta,
  ConfirmMilestoneInput,
  RecordZoneQaInput,
  RegisterDocumentInput,
  UpdateScopeInput,
  ZoneDeliveryActivity,
  ZoneDeliveryView,
  ZoneKey,
} from '../types/zoneDelivery.types';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}
type ZoneCommand<T> = Omit<T, keyof ZoneKey>;
export type ScopeCommand = ZoneCommand<UpdateScopeInput>;
export type MilestoneCommand = ZoneCommand<ConfirmMilestoneInput>;
export type ZoneQaCommand = ZoneCommand<RecordZoneQaInput>;
export interface DocumentUploadCommand extends CommandMeta {
  file: File;
  documentType: RegisterDocumentInput['documentType'];
  ponStageId?: string;
}

export interface ZoneDeliveryZoneState {
  zone: ZoneDeliveryView | null;
  activity: ZoneDeliveryActivity[];
  loading: boolean;
  refreshing: boolean;
  mutating: boolean;
  error: string | null;
  errorCode: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  updateScope: (input: ScopeCommand) => Promise<void>;
  confirmMilestone: (input: MilestoneCommand) => Promise<void>;
  recordZoneQa: (input: ZoneQaCommand) => Promise<void>;
  uploadDocument: (input: DocumentUploadCommand) => Promise<void>;
}

class RequestFailure extends Error {
  constructor(message: string, readonly code: string | null = null) {
    super(message);
  }
}

async function readEnvelope<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new RequestFailure(payload.error?.message ?? fallback, payload.error?.code ?? null);
  }
  return payload.data;
}

const readUrl = (resource: 'zone' | 'activity', key: ZoneKey) =>
  `/api/zone-delivery/${resource}?project_id=${encodeURIComponent(key.projectId)}&zone_no=${key.zoneNo}`;

export function useZoneDeliveryZone(key: ZoneKey): ZoneDeliveryZoneState {
  const { projectId, zoneNo } = key;
  const [zone, setZone] = useState<ZoneDeliveryView | null>(null);
  const [activity, setActivity] = useState<ZoneDeliveryActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const showError = useCallback((failure: unknown) => {
    if (!mountedRef.current) return;
    setError(failure instanceof Error ? failure.message : 'Zone delivery request failed.');
    setErrorCode(failure instanceof RequestFailure ? failure.code : null);
  }, []);

  const load = useCallback(async (isRefresh: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    controllerRef.current = controller;
    setError(null);
    setErrorCode(null);
    if (isRefresh) setRefreshing(true);
    else {
      setLoading(true);
      setZone(null);
      setActivity([]);
      setLastUpdated(null);
    }
    try {
      const init = { credentials: 'include' as const, signal: controller.signal };
      const [zoneResponse, activityResponse] = await Promise.all([
        fetch(readUrl('zone', { projectId, zoneNo }), init),
        fetch(readUrl('activity', { projectId, zoneNo }), init),
      ]);
      const [nextZone, nextActivity] = await Promise.all([
        readEnvelope<ZoneDeliveryView>(zoneResponse, 'Unable to load zone delivery.'),
        readEnvelope<ZoneDeliveryActivity[]>(activityResponse, 'Unable to load zone activity.'),
      ]);
      if (mountedRef.current && requestIdRef.current === requestId) {
        setZone(nextZone);
        setActivity(nextActivity);
        setLastUpdated(new Date());
      }
    } catch (failure) {
      if (!(failure instanceof Error && failure.name === 'AbortError')
        && requestIdRef.current === requestId) showError(failure);
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [projectId, showError, zoneNo]);

  useEffect(() => {
    mountedRef.current = true;
    void load(false);
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, [load]);

  const command = useCallback(async (
    url: string,
    body: BodyInit,
    contentType?: string,
  ) => {
    setMutating(true);
    setError(null);
    setErrorCode(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        ...(contentType ? { headers: { 'Content-Type': contentType } } : {}),
        body,
      });
      await readEnvelope<unknown>(response, 'Zone delivery action failed.');
      await load(true);
    } catch (failure) {
      showError(failure);
    } finally {
      if (mountedRef.current) setMutating(false);
    }
  }, [load, showError]);

  const jsonCommand = useCallback(<T extends object>(url: string, input: T) =>
    command(url, JSON.stringify({ projectId, zoneNo, ...input }), 'application/json'), [
    command, projectId, zoneNo,
  ]);

  const uploadDocument = useCallback(async (input: DocumentUploadCommand) => {
    const form = new FormData();
    form.set('file', input.file);
    form.set('projectId', projectId);
    form.set('zoneNo', String(zoneNo));
    form.set('expectedRowVersion', String(input.expectedRowVersion));
    form.set('effectiveAt', input.effectiveAt);
    form.set('source', input.source);
    if (input.reason) form.set('reason', input.reason);
    form.set('documentType', input.documentType);
    if (input.documentType === 'test_pack' && input.ponStageId) {
      form.set('ponStageId', input.ponStageId);
    }
    await command('/api/zone-delivery/document', form);
  }, [command, projectId, zoneNo]);

  return {
    zone, activity, loading, refreshing, mutating, error, errorCode, lastUpdated,
    refresh: () => load(true),
    updateScope: input => jsonCommand('/api/zone-delivery/scope', input),
    confirmMilestone: input => jsonCommand('/api/zone-delivery/pon-milestone', input),
    recordZoneQa: input => jsonCommand('/api/zone-delivery/zone-qa', input),
    uploadDocument,
  };
}
