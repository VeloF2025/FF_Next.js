'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Pin, X, Loader2, ExternalLink } from 'lucide-react';
import { log } from '@/lib/logger';
import { useAuth } from '@/contexts/AuthContext';

interface PinnedLink {
  id: string;
  label: string;
  route: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  expires_at: string | null;
  created_at: string;
}

export function PinnedLinks() {
  const { currentUser } = useAuth();
  const [pins, setPins] = useState<PinnedLink[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPins = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/pinned-links');
      if (!res.ok) throw new Error('Failed to fetch pins');
      const data = await res.json();
      setPins(data.data?.pins || []);
    } catch (error) {
      log.error('Failed to load pinned links', { error });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    fetchPins();
  }, [currentUser, fetchPins]);

  // Listen for pin changes from PinButton
  useEffect(() => {
    const handler = () => fetchPins();
    window.addEventListener('pinned-links-changed', handler);
    return () => window.removeEventListener('pinned-links-changed', handler);
  }, [fetchPins]);

  const handleUnpin = async (pinId: string) => {
    try {
      const res = await fetch(`/api/dashboard/pinned-links?id=${pinId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to unpin');
      setPins(prev => prev.filter(p => p.id !== pinId));
      window.dispatchEvent(new CustomEvent('pinned-links-changed'));
    } catch (error) {
      log.error('Failed to unpin link', { error });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-text-tertiary)]" />
        <span className="text-sm text-[var(--ff-text-tertiary)]">Loading pins...</span>
      </div>
    );
  }

  if (pins.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm text-[var(--ff-text-tertiary)]">Pins</h3>
        </div>
        <div className="flex items-center gap-2 px-3 py-3 rounded-lg border border-dashed border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)]">
          <Pin className="w-4 h-4" />
          <span className="text-sm">
            Pin frequently used views from any page using the pin icon in the header
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm text-[var(--ff-text-tertiary)]">Pins</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]">
          {pins.length}/6
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {pins.map((pin) => (
          <div
            key={pin.id}
            className="group relative flex items-center gap-2 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:border-primary-500/50 hover:bg-[var(--ff-bg-tertiary)] transition-all duration-200"
          >
            <Link
              href={pin.route}
              className="flex items-center gap-2 px-3 py-2"
              title={pin.route}
            >
              <Pin className={`w-3.5 h-3.5 ${pin.color || 'text-primary-400'}`} />
              <span className="text-sm font-medium text-[var(--ff-text-primary)] group-hover:text-primary-400 transition-colors">
                {pin.label}
              </span>
              {pin.expires_at && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-warning-500/10 text-warning-400">
                  temp
                </span>
              )}
            </Link>
            <button
              onClick={(e) => {
                e.preventDefault();
                handleUnpin(pin.id);
              }}
              className="pr-2 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove pin"
            >
              <X className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
