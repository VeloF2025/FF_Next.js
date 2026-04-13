'use client';

/**
 * SettingsTab
 * Communications Hub Settings panel.
 * Sections: Notification Preferences, Quiet Hours, Email Signature.
 * Imported by CommunicationsHub at ./settings/SettingsTab.
 */

import { Bell, Save } from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { useNotificationSettings } from '../hooks/useNotificationSettings';
import { NotificationPreferencesGrid } from './NotificationPreferencesGrid';
import { QuietHoursCard } from './QuietHoursCard';
import { EmailSignatureCard } from './EmailSignatureCard';

export function SettingsTab() {
  const {
    preferences,
    globalSettings,
    isLoading,
    isSaving,
    isDirty,
    save,
    updatePreference,
    updateGlobalSettings,
  } = useNotificationSettings();

  const handleSave = async () => {
    await save();
  };

  // --- Loading skeleton ---
  if (isLoading) {
    return (
      <LoadingSpinner className="py-16" size="sm" label="Loading settings..." />
    );
  }

  return (
    <div className="space-y-8">
      {/* Page header with Save button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--ff-text-primary)]">
            Notification Settings
          </h2>
          <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
            Control how and when FibreFlow notifies you.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            isDirty && !isSaving
              ? 'bg-[var(--ff-primary)] text-white hover:opacity-90'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
          )}
        >
          {isSaving ? (
            <InlineSpinner size="sm" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isSaving ? 'Saving...' : isDirty ? 'Save Changes' : 'Saved'}
        </button>
      </div>

      {/* Section: Notification Preferences */}
      <section aria-labelledby="prefs-heading">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          <h3
            id="prefs-heading"
            className="text-sm font-semibold text-[var(--ff-text-primary)]"
          >
            Notification Preferences
          </h3>
        </div>
        <p className="text-xs text-[var(--ff-text-secondary)] mb-3">
          Choose which channels receive each type of notification.
          Custom overrides are highlighted. Unchecked events are never sent via that channel.
        </p>
        <NotificationPreferencesGrid
          preferences={preferences}
          updatePreference={updatePreference}
        />
      </section>

      {/* Section: Global Settings — side-by-side cards on wider screens */}
      <section aria-labelledby="global-heading">
        <h3
          id="global-heading"
          className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3"
        >
          Global Settings
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuietHoursCard
            settings={globalSettings}
            onChange={updateGlobalSettings}
          />
          <EmailSignatureCard
            settings={globalSettings}
            onChange={updateGlobalSettings}
          />
        </div>
      </section>
    </div>
  );
}
