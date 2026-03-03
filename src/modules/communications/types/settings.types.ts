/**
 * Type definitions for user communication settings.
 * Shared between the API route and client-side components/hooks.
 */

/** Global communication settings stored in user_communication_settings table */
export interface UserCommunicationSettings {
  quiet_hours_enabled: boolean;
  /** HH:mm format, e.g. "22:00" */
  quiet_hours_start: string;
  /** HH:mm format, e.g. "07:00" */
  quiet_hours_end: string;
  digest_frequency: 'immediate' | 'hourly' | 'daily';
  email_signature: string | null;
}

export interface CommunicationsSettingsResponse {
  preferences: import('@/modules/notifications/types').MergedPreference[];
  globalSettings: UserCommunicationSettings;
}
