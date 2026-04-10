'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Pin, X, Loader2, Plus } from 'lucide-react';
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

  const emptySlots = MAX_SLOTS - pins.length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm text-[var(--ff-text-tertiary)]">Pins</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]">
          {pins.length}/{MAX_SLOTS}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {pins.map((pin, index) => (
          <div
            key={pin.id}
            draggable
            onDragStart={(e) => handleDragStart(index, e)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(index, e)}
            className={`
              group flex items-center gap-2 px-3 py-2 rounded-lg
              bg-[var(--ff-bg-secondary)] border
              ${dragOverIndex === index && dragIndex !== null
                ? 'border-primary-500 ring-1 ring-primary-500/30'
                : 'border-[var(--ff-border-light)]'}
              hover:border-primary-500/50 hover:bg-[var(--ff-bg-tertiary)]
              transition-all duration-200 cursor-grab active:cursor-grabbing
            `}
          >
            <Pin className={`w-4 h-4 ${pin.color || 'text-primary-400'}`} />
            <Link
              href={pin.route}
              className="text-sm font-medium text-[var(--ff-text-primary)] group-hover:text-primary-400 transition-colors whitespace-nowrap"
              title={pin.route}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            >
              {pin.label}
            </Link>
            {pin.expires_at && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-warning-500/10 text-warning-400">
                temp
              </span>
            )}
            <button
              onClick={() => handleUnpin(pin.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
              title="Remove pin"
            >
              <X className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors" />
            </button>
          </div>
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div
            key={`empty-${i}`}
            onDragOver={(e) => handleDragOver(pins.length + i, e)}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg
              border border-dashed
              ${dragOverIndex === pins.length + i && dragIndex !== null
                ? 'border-primary-500/50 bg-primary-500/5'
                : 'border-[var(--ff-border-light)]'}
              transition-all duration-200
            `}
          >
            <Plus className="w-4 h-4 text-[var(--ff-text-tertiary)] opacity-30" />
            <span className="text-sm text-[var(--ff-text-tertiary)] opacity-30">Empty</span>
          </div>
        ))}
      </div>
    </div>
  );
}
