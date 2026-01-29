/**
 * Notifications Section
 *
 * Configure which procurement events trigger notifications
 * and through which channels (email, in-app, WhatsApp).
 */

import { useState, useEffect, useCallback } from 'react';
import { Save, Loader2, AlertCircle, Mail, Bell, MessageCircle } from 'lucide-react';

interface NotificationConfig {
  id: string;
  eventType: string;
  label: string;
  description: string;
  enabled: boolean;
  channels: { email: boolean; in_app: boolean; whatsapp: boolean };
  recipients: { roles: string[]; user_ids: string[] };
}

const EVENT_GROUPS: Record<string, string[]> = {
  'Requisitions': ['pr_submitted', 'pr_approved', 'pr_rejected'],
  'Purchase Orders': ['po_submitted', 'po_approved', 'po_rejected'],
  'Sourcing': ['rfq_created', 'rfq_response_received'],
  'Goods Receipt': ['grn_received', 'grn_discrepancy'],
  'Approvals': ['approval_overdue', 'approval_escalated'],
};

export function NotificationsSection() {
  const [notifications, setNotifications] = useState<NotificationConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/settings/procurement/notifications');
      const json = await res.json();
      if (json.success) {
        setNotifications(json.data.notifications);
      } else {
        setError(json.error?.message || 'Failed to load');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateNotification = (id: string, updates: Partial<NotificationConfig>) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, ...updates } : n)
    );
    setIsDirty(true);
  };

  const toggleChannel = (id: string, channel: 'email' | 'in_app' | 'whatsapp') => {
    const notif = notifications.find(n => n.id === id);
    if (!notif) return;
    updateNotification(id, {
      channels: { ...notif.channels, [channel]: !notif.channels[channel] },
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/procurement/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notifications: notifications.map(n => ({
            id: n.id,
            enabled: n.enabled,
            channels: n.channels,
            recipients: n.recipients,
          })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setIsDirty(false);
      }
    } catch {
      setError('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--ff-text-secondary)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading notifications...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-4 text-red-400">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      {/* Channel Legend */}
      <div className="flex items-center gap-4 text-xs text-[var(--ff-text-secondary)]">
        <div className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</div>
        <div className="flex items-center gap-1"><Bell className="w-3.5 h-3.5" /> In-App</div>
        <div className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</div>
      </div>

      {Object.entries(EVENT_GROUPS).map(([group, eventTypes]) => {
        const groupNotifs = notifications.filter(n => eventTypes.includes(n.eventType));
        if (groupNotifs.length === 0) return null;

        return (
          <div key={group}>
            <h5 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">{group}</h5>
            <div className="space-y-1">
              {groupNotifs.map(notif => (
                <div
                  key={notif.id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    notif.enabled
                      ? 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]'
                      : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={notif.enabled}
                      onChange={e => updateNotification(notif.id, { enabled: e.target.checked })}
                      className="rounded bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--ff-text-primary)] truncate">{notif.label}</div>
                      <div className="text-xs text-[var(--ff-text-secondary)] truncate">{notif.description}</div>
                    </div>
                  </div>

                  {notif.enabled && (
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <button
                        onClick={() => toggleChannel(notif.id, 'email')}
                        className={`p-1.5 rounded transition-colors ${
                          notif.channels.email
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
                        }`}
                        title="Email"
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggleChannel(notif.id, 'in_app')}
                        className={`p-1.5 rounded transition-colors ${
                          notif.channels.in_app
                            ? 'bg-green-500/20 text-green-400'
                            : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
                        }`}
                        title="In-App"
                      >
                        <Bell className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggleChannel(notif.id, 'whatsapp')}
                        className={`p-1.5 rounded transition-colors ${
                          notif.channels.whatsapp
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
                        }`}
                        title="WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {isDirty && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-1"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
