'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { Pin, X, Calendar, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import { cn } from '@/utils/cn';

interface PinButtonProps {
  className?: string;
}

export function PinButton({ className }: PinButtonProps) {
  const router = useRouter();
  const [isPinned, setIsPinned] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const currentRoute = router.asPath;
  const isDashboard = currentRoute === '/dashboard' || currentRoute === '/';

  // Check if current route is pinned
  useEffect(() => {
    if (isDashboard) return;

    async function checkPinned() {
      setLoading(true);
      try {
        const res = await fetch('/api/dashboard/pinned-links');
        if (!res.ok) return;
        const data = await res.json();
        const pins = data.data?.pins || [];
        const found = pins.some((p: any) => p.route === currentRoute);
        setIsPinned(found);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }

    checkPinned();
  }, [currentRoute, isDashboard]);

  // Listen for changes from dashboard
  useEffect(() => {
    const handler = () => {
      // Re-check pin status
      fetch('/api/dashboard/pinned-links')
        .then(r => r.json())
        .then(data => {
          const pins = data.data?.pins || [];
          setIsPinned(pins.some((p: any) => p.route === currentRoute));
        })
        .catch(() => {});
    };
    window.addEventListener('pinned-links-changed', handler);
    return () => window.removeEventListener('pinned-links-changed', handler);
  }, [currentRoute]);

  // Close popover on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    if (showPopover) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPopover]);

  // Generate a default label from the page title and route
  useEffect(() => {
    if (!showPopover) return;
    const title = document.title?.replace(' | FibreFlow', '').replace('FibreFlow - ', '') || '';
    const queryParams = currentRoute.includes('?')
      ? new URLSearchParams(currentRoute.split('?')[1])
      : null;

    let defaultLabel = title;
    if (queryParams) {
      const filters: string[] = [];
      queryParams.forEach((value, key) => {
        if (key !== 'page' && key !== 'limit') {
          filters.push(value);
        }
      });
      if (filters.length > 0) {
        defaultLabel = `${title} - ${filters.join(', ')}`;
      }
    }
    setLabel(defaultLabel.slice(0, 100));
  }, [showPopover, currentRoute]);

  const handlePin = async () => {
    if (isPinned) {
      // Unpin
      try {
        const res = await fetch(`/api/dashboard/pinned-links?route=${encodeURIComponent(currentRoute)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setIsPinned(false);
          window.dispatchEvent(new CustomEvent('pinned-links-changed'));
        }
      } catch (error) {
        log.error('Failed to unpin', { error });
      }
      return;
    }

    setShowPopover(true);
  };

  const handleSave = async () => {
    if (!label.trim()) return;
    setSaving(true);

    try {
      const res = await fetch('/api/dashboard/pinned-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          route: currentRoute,
          expiresAt: expiresAt || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const msg = data.error?.message || 'Failed to pin';
        log.error('Pin failed', { msg });
        return;
      }

      setIsPinned(true);
      setShowPopover(false);
      setExpiresAt('');
      window.dispatchEvent(new CustomEvent('pinned-links-changed'));
    } catch (error) {
      log.error('Failed to pin view', { error });
    } finally {
      setSaving(false);
    }
  };

  // Don't show on dashboard
  if (isDashboard) return null;

  return (
    <div className={cn('relative', className)} ref={popoverRef}>
      <button
        onClick={handlePin}
        disabled={loading}
        className={cn(
          'p-2 rounded-lg transition-colors',
          isPinned
            ? 'text-primary-400 hover:text-primary-300 bg-primary-500/10'
            : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)]',
        )}
        title={isPinned ? 'Unpin this view from dashboard' : 'Pin this view to dashboard'}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Pin className={cn('h-4 w-4', isPinned && 'fill-current')} />
        )}
      </button>

      {showPopover && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-[var(--ff-surface-primary)] border border-[var(--ff-border-primary)] rounded-lg shadow-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-[var(--ff-text-primary)]">Pin to Dashboard</h4>
            <button onClick={() => setShowPopover(false)} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-[var(--ff-text-secondary)] mb-1 block">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={100}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] focus:outline-none focus:border-primary-500"
                placeholder="Name this view..."
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-[var(--ff-text-secondary)] mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Expires (optional)
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] focus:outline-none focus:border-primary-500"
              />
            </div>

            <div className="text-xs text-[var(--ff-text-tertiary)] truncate" title={currentRoute}>
              {currentRoute}
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !label.trim()}
              className="w-full py-2 px-4 text-sm font-medium rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pin className="w-4 h-4" />}
              Pin to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
