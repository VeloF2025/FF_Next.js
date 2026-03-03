/**
 * Hook for fetching and saving communication settings.
 * Combines per-event notification preferences with global quiet-hours / email-signature settings.
 */

import { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import type { MergedPreference } from '@/modules/notifications/types';
import type { UserCommunicationSettings } from '@/modules/communications/types/settings.types';

/** Return shape of the hook */
export interface UseNotificationSettingsReturn {
  preferences: MergedPreference[];
  globalSettings: UserCommunicationSettings;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  save: () => Promise<boolean>;
  updatePreference: (eventType: string, channel: 'in_app' | 'email' | 'whatsapp', value: boolean) => void;
  updateGlobalSettings: (patch: Partial<UserCommunicationSettings>) => void;
}

const DEFAULT_GLOBAL: UserCommunicationSettings = {
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  digest_frequency: 'immediate',
  email_signature: null,
};

export function useNotificationSettings(): UseNotificationSettingsReturn {
  const [preferences, setPreferences] = useState<MergedPreference[]>([]);
  const [globalSettings, setGlobalSettings] = useState<UserCommunicationSettings>(DEFAULT_GLOBAL);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Fetch settings on mount
  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/communications/settings', {
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setPreferences(json.data.preferences);
        setGlobalSettings(json.data.globalSettings);
        setIsDirty(false);
      } else {
        log.error('Failed to load communication settings', { error: json.error });
      }
    } catch (err) {
      log.error('Failed to fetch communication settings', { err });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  /** Update a single channel flag for a given event type */
  const updatePreference = useCallback(
    (eventType: string, channel: 'in_app' | 'email' | 'whatsapp', value: boolean) => {
      setPreferences(prev =>
        prev.map(p =>
          p.event_type === eventType
            ? { ...p, [`channel_${channel}`]: value, is_user_override: true }
            : p
        )
      );
      setIsDirty(true);
    },
    []
  );

  /** Merge a partial update into global settings */
  const updateGlobalSettings = useCallback((patch: Partial<UserCommunicationSettings>) => {
    setGlobalSettings(prev => ({ ...prev, ...patch }));
    setIsDirty(true);
  }, []);

  /**
   * Persist both preferences and global settings.
   * Returns true on success, false on failure.
   */
  const save = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/communications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preferences,
          globalSettings,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setIsDirty(false);
        return true;
      }
      log.error('Failed to save communication settings', { error: json.error });
      return false;
    } catch (err) {
      log.error('Save communication settings threw', { err });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [preferences, globalSettings]);

  return {
    preferences,
    globalSettings,
    isLoading,
    isSaving,
    isDirty,
    save,
    updatePreference,
    updateGlobalSettings,
  };
}
