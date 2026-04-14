import { useState, useEffect } from 'react';
import { Bell, Plus, Trash2, Check, X, Calendar } from 'lucide-react';
import { log } from '@/lib/logger';

interface Reminder {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed' | 'dismissed';
  created_at: string;
}

interface ReminderPreferences {
  enabled: boolean;
  send_time: string;
  timezone: string;
}

export function RemindersTab() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [preferences, setPreferences] = useState<ReminderPreferences>({
    enabled: true,
    send_time: '08:00:00',
    timezone: 'UTC'
  });
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newReminder, setNewReminder] = useState<{
    title: string;
    description: string;
    due_date: string;
    priority: Reminder['priority'];
  }>({
    title: '',
    description: '',
    due_date: '',
    priority: 'medium',
  });

  useEffect(() => {
    fetchReminders();
    fetchPreferences();
  }, []);

  const fetchReminders = async () => {
    try {
      const res = await fetch('/api/reminders?status=pending');
      const data = await res.json();
      if (data.success) {
        setReminders(data.data);
      }
    } catch (error) {
      log.error('Failed to fetch reminders', { error }, 'RemindersTab');
    } finally {
      setLoading(false);
    }
  };

  const fetchPreferences = async () => {
    try {
      const res = await fetch('/api/reminder-preferences');
      const data = await res.json();
      if (data.success) {
        setPreferences(data.data);
      }
    } catch (error) {
      log.error('Failed to fetch preferences', { error }, 'RemindersTab');
    }
  };

  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newReminder)
      });
      const data = await res.json();
      if (data.success) {
        setReminders([data.data, ...reminders]);
        setNewReminder({ title: '', description: '', due_date: '', priority: 'medium' });
        setShowNewForm(false);
      }
    } catch (error) {
      log.error('Failed to create reminder', { error }, 'RemindersTab');
    }
  };

  const handleUpdateStatus = async (id: string, status: 'completed' | 'dismissed') => {
    try {
      const res = await fetch('/api/reminders-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      });
      const data = await res.json();
      if (data.success) {
        setReminders(reminders.filter(r => r.id !== id));
      }
    } catch (error) {
      log.error('Failed to update reminder', { error }, 'RemindersTab');
    }
  };

  const handleDeleteReminder = async (id: string) => {
    if (!confirm('Are you sure you want to delete this reminder?')) return;
    try {
      const res = await fetch(`/api/reminders-delete?id=${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setReminders(reminders.filter(r => r.id !== id));
      }
    } catch (error) {
      log.error('Failed to delete reminder', { error }, 'RemindersTab');
    }
  };

  const handleUpdatePreferences = async (updates: Partial<ReminderPreferences>) => {
    try {
      const res = await fetch('/api/reminder-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        setPreferences(data.data);
      }
    } catch (error) {
      log.error('Failed to update preferences', { error }, 'RemindersTab');
    }
  };

  const priorityColors = {
    high: 'bg-red-500/20 text-red-400',
    medium: 'bg-amber-500/20 text-amber-400',
    low: 'bg-blue-500/20 text-blue-400'
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Email Preferences */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Bell className="w-5 h-5 mr-2" />
          Daily Email Reminders
        </h3>

        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium">Enable daily email reminders</span>
            <input
              type="checkbox"
              className="rounded"
              checked={preferences.enabled}
              onChange={(e) => handleUpdatePreferences({ enabled: e.target.checked })}
            />
          </label>

          {preferences.enabled && (
            <div className="pl-4 border-l-2 border-blue-500 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Send time</label>
                <input
                  type="time"
                  className="rounded-lg border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]"
                  value={preferences.send_time.slice(0, 5)}
                  onChange={(e) => handleUpdatePreferences({ send_time: `${e.target.value}:00` })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Timezone</label>
                <select
                  className="rounded-lg border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]"
                  value={preferences.timezone}
                  onChange={(e) => handleUpdatePreferences({ timezone: e.target.value })}
                >
                  <option value="UTC">UTC</option>
                  <option value="Africa/Johannesburg">South Africa (SAST)</option>
                  <option value="Europe/London">London (GMT)</option>
                  <option value="America/New_York">New York (EST)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reminders List */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Your Reminders</h3>
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Reminder</span>
          </button>
        </div>

        {/* New Reminder Form */}
        {showNewForm && (
          <form onSubmit={handleCreateReminder} className="mb-6 p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title *</label>
                <input
                  type="text"
                  required
                  className="w-full rounded-lg border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]"
                  value={newReminder.title}
                  onChange={(e) => setNewReminder({ ...newReminder, title: e.target.value })}
                  placeholder="e.g., Review contractor invoices"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  className="w-full rounded-lg border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]"
                  rows={2}
                  value={newReminder.description}
                  onChange={(e) => setNewReminder({ ...newReminder, description: e.target.value })}
                  placeholder="Additional details..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Due Date</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]"
                    value={newReminder.due_date}
                    onChange={(e) => setNewReminder({ ...newReminder, due_date: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select
                    className="w-full rounded-lg border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]"
                    value={newReminder.priority}
                    onChange={(e) => setNewReminder({ ...newReminder, priority: e.target.value as Reminder['priority'] })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div className="flex space-x-2">
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Create Reminder
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  className="bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)] px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Reminders List */}
        {reminders.length === 0 ? (
          <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
            No pending reminders. Click &quot;Add Reminder&quot; to create one.
          </div>
        ) : (
          <div className="space-y-3">
            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className="flex items-start space-x-4 p-4 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium">{reminder.title}</h4>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${priorityColors[reminder.priority]}`}>
                      {reminder.priority}
                    </span>
                  </div>
                  {reminder.description && (
                    <p className="text-sm text-[var(--ff-text-secondary)] mb-2">
                      {reminder.description}
                    </p>
                  )}
                  {reminder.due_date && (
                    <div className="flex items-center text-xs text-[var(--ff-text-tertiary)]">
                      <Calendar className="w-3 h-3 mr-1" />
                      Due: {new Date(reminder.due_date).toISOString().split('T')[0]}
                    </div>
                  )}
                </div>

                <div className="flex space-x-2">
                  <button
                    onClick={() => handleUpdateStatus(reminder.id, 'completed')}
                    className="p-2 text-green-600 hover:bg-green-500/20 rounded-lg transition-colors"
                    title="Mark as completed"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(reminder.id, 'dismissed')}
                    className="p-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
                    title="Dismiss"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteReminder(reminder.id)}
                    className="p-2 text-red-600 hover:bg-red-500/20 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
