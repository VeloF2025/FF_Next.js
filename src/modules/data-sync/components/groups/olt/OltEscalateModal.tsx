/**
 * OltEscalateModal — modal for escalating records to an admin
 */

'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface OltEscalateModalProps {
  recordId: string;
  onClose: () => void;
  onEscalated: () => void;
  setError: (e: string | null) => void;
}

export function OltEscalateModal({ recordId, onClose, onEscalated, setError }: OltEscalateModalProps) {
  const [escalateTo, setEscalateTo] = useState('');
  const [notes, setNotes] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [adminUsers, setAdminUsers] = useState<Array<{ id: string; email: string; name: string }>>([]);

  // Lazy-load admin users when modal opens
  useEffect(() => {
    const fetchAdminUsers = async () => {
      try {
        const res = await fetch('/api/system/olt-report/admin-users');
        if (res.ok) {
          const data = await res.json();
          setAdminUsers(data.data || data || []);
        }
      } catch (error) {
        log.warn('OltEscalateModal', { action: 'fetchAdminUsersFailed', error });
      }
    };
    fetchAdminUsers();
  }, []);

  const handleEscalate = async () => {
    if (!escalateTo) {
      setError('Please select an admin to escalate to');
      return;
    }
    setEscalating(true);
    try {
      const res = await fetch('/api/system/olt-report/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          action: 'escalate',
          escalateTo,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success || data.data?.success) {
        onClose();
        onEscalated();
      } else {
        setError(typeof data.error === 'string' ? data.error : data.error?.message || 'Escalate failed');
      }
    } catch {
      setError('Escalate failed');
    } finally {
      setEscalating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 w-full max-w-md border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
          Escalate to Admin
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Escalate To
            </label>
            <select
              value={escalateTo}
              onChange={(e) => setEscalateTo(e.target.value)}
              className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
            >
              <option value="">Select admin...</option>
              {adminUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
              placeholder="Explain why this needs escalation..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]/80"
            >
              Cancel
            </button>
            <button
              onClick={handleEscalate}
              disabled={!escalateTo || escalating}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {escalating ? <InlineSpinner size="sm" /> : <AlertTriangle className="w-4 h-4" />}
              Escalate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
