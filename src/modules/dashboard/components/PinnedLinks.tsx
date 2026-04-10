'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Pin, X, Loader2, GripVertical, Plus } from 'lucide-react';
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

const MAX_SLOTS = 6;

export function PinnedLinks() {
  const { currentUser } = useAuth();
  const [pins, setPins] = useState<PinnedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragNode = useRef<HTMLDivElement | null>(null);

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

  const saveOrder = async (reordered: PinnedLink[]) => {
    const orderedIds = reordered.map(p => p.id);
    try {
      await fetch('/api/dashboard/pinned-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
    } catch (error) {
      log.error('Failed to save pin order', { error });
    }
  };

  const handleDragStart = (index: number, e: React.DragEvent<HTMLDivElement>) => {
    setDragIndex(index);
    dragNode.current = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => {
      if (dragNode.current) {
        dragNode.current.style.opacity = '0.4';
      }
    });
  };

  const handleDragEnd = () => {
    if (dragNode.current) {
      dragNode.current.style.opacity = '1';
    }
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const reordered = [...pins];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(dragOverIndex, 0, moved);
      setPins(reordered);
      saveOrder(reordered);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragNode.current = null;
  };

  const handleDragOver = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null && index !== dragOverIndex) {
      setDragOverIndex(index);
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

  const slots: (PinnedLink | null)[] = Array.from(
    { length: MAX_SLOTS },
    (_, i) => pins[i] || null
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm text-[var(--ff-text-tertiary)]">Pins</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]">
          {pins.length}/{MAX_SLOTS}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {slots.map((pin, index) =>
          pin ? (
            <div
              key={pin.id}
              draggable
              onDragStart={(e) => handleDragStart(index, e)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(index, e)}
              className={`
                group relative flex items-center gap-2 rounded-lg
                bg-[var(--ff-bg-secondary)] border
                ${dragOverIndex === index && dragIndex !== null
                  ? 'border-primary-500 ring-1 ring-primary-500/30'
                  : 'border-[var(--ff-border-light)]'}
                hover:border-primary-500/50 hover:bg-[var(--ff-bg-tertiary)]
                transition-all duration-200 cursor-grab active:cursor-grabbing
                min-h-[72px]
              `}
            >
              <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-opacity">
                <GripVertical className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" />
              </div>
              <Link
                href={pin.route}
                className="flex-1 flex flex-col items-center justify-center px-3 py-3 min-w-0 text-center"
                title={pin.route}
                onClick={(e) => e.stopPropagation()}
                draggable={false}
              >
                <Pin className={`w-4 h-4 mb-1 ${pin.color || 'text-primary-400'}`} />
                <span className="text-xs font-medium text-[var(--ff-text-primary)] group-hover:text-primary-400 transition-colors truncate w-full">
                  {pin.label}
                </span>
                {pin.expires_at && (
                  <span className="text-[9px] px-1 py-0.5 mt-1 rounded bg-warning-500/10 text-warning-400">
                    temp
                  </span>
                )}
              </Link>
              <button
                onClick={() => handleUnpin(pin.id)}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/10"
                title="Remove pin"
              >
                <X className="w-3 h-3 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors" />
              </button>
            </div>
          ) : (
            <div
              key={`empty-${index}`}
              onDragOver={(e) => handleDragOver(index, e)}
              className={`
                flex flex-col items-center justify-center rounded-lg
                border border-dashed min-h-[72px]
                ${dragOverIndex === index && dragIndex !== null
                  ? 'border-primary-500/50 bg-primary-500/5'
                  : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]'}
                transition-all duration-200
              `}
            >
              <Plus className="w-4 h-4 text-[var(--ff-text-tertiary)] opacity-30" />
              <span className="text-[10px] text-[var(--ff-text-tertiary)] opacity-30 mt-0.5">
                Empty
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
