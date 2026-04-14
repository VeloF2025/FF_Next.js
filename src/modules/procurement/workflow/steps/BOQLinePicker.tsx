/**
 * BOQLinePicker — searchable dropdown to pick a BOQ line item.
 * Shows outstanding qty with color coding; uses portal to escape overflow containers.
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import type { BOQLineUtilization } from '@/types/procurement/boq-utilization.types';

interface BOQLinePickerProps {
  boqLines: BOQLineUtilization[];
  selectedId: string | undefined;
  onSelect: (line: BOQLineUtilization) => void;
  onClear: () => void;
}

function statusColor(line: BOQLineUtilization): string {
  if (line.status === 'fully_ordered' || line.status === 'over_ordered') return 'text-red-400';
  if (line.status === 'partial') return 'text-amber-400';
  return 'text-emerald-400';
}

function statusDot(line: BOQLineUtilization): string {
  if (line.status === 'fully_ordered' || line.status === 'over_ordered') return '●';
  if (line.status === 'partial') return '◑';
  return '○';
}

export function BOQLinePicker({ boqLines, selectedId, onSelect, onClear }: BOQLinePickerProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = boqLines.find((l) => l.id === selectedId);

  const filtered = boqLines.filter((l) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      l.description.toLowerCase().includes(q) ||
      (l.itemCode ?? '').toLowerCase().includes(q)
    );
  });

  // Sort: available first, then partial, then fully ordered
  const order: Record<BOQLineUtilization['status'], number> = {
    not_ordered: 0,
    partial: 1,
    partially_received: 2,
    fully_ordered: 3,
    over_ordered: 4,
    received: 5,
  };
  const sorted = [...filtered].sort((a, b) => order[a.status] - order[b.status]);

  // Update portal position
  useEffect(() => {
    if (!isOpen || !inputRef.current) return;
    const updatePos = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 360),
        zIndex: 9999,
      });
    };
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      const dropdown = document.querySelector('[data-boq-dropdown]');
      if (dropdown?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const handleSelect = (line: BOQLineUtilization) => {
    setQuery('');
    setIsOpen(false);
    onSelect(line);
  };

  const handleClear = () => {
    setQuery('');
    setIsOpen(false);
    onClear();
  };

  const displayValue = selected
    ? `${selected.itemCode ? selected.itemCode + ' — ' : ''}${selected.description}`
    : '';

  const dropdownContent = (
    <div
      data-boq-dropdown
      style={dropdownStyle}
      className="max-h-64 overflow-auto rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-xl"
    >
      {sorted.length === 0 ? (
        <div className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)]">No BOQ lines match</div>
      ) : (
        sorted.map((line) => {
          const dotColor = statusColor(line);
          const dot = statusDot(line);
          const isFullyOrdered = line.status === 'fully_ordered' || line.status === 'over_ordered';
          return (
            <button
              key={line.id}
              type="button"
              onClick={() => handleSelect(line)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--ff-bg-hover)] ${
                isFullyOrdered ? 'opacity-60' : ''
              } ${selectedId === line.id ? 'bg-[var(--ff-bg-hover)]' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--ff-text-primary)] truncate">
                  {line.itemCode && (
                    <span className="text-blue-400 mr-1.5 text-xs">{line.itemCode}</span>
                  )}
                  {line.description}
                </span>
                <span className={`shrink-0 text-xs ${dotColor}`}>
                  {dot} {line.outstandingQty.toLocaleString()} {line.uom}
                </span>
              </div>
              <div className="flex gap-3 mt-0.5 text-xs text-[var(--ff-text-tertiary)]">
                <span>BOQ: {line.boqQty.toLocaleString()} {line.uom}</span>
                <span>Ordered: {line.orderedQty.toLocaleString()}</span>
                {line.outstandingQty <= 0 && (
                  <span className="text-red-400">Fully ordered</span>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ff-text-tertiary)]" />
        <input
          ref={inputRef}
          type="text"
          value={selected ? displayValue : query}
          onChange={(e) => {
            if (selected) return; // prevent editing when selected; use clear button
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => { if (!selected) setIsOpen(true); }}
          placeholder="Search BOQ item code or description..."
          readOnly={!!selected}
          className={`w-full pl-7 pr-7 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-purple-500/50 ${selected ? 'cursor-default' : ''}`}
        />
        {(selected || query) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Inline badge when BOQ line is selected */}
      {selected && (
        <div className="mt-1 flex gap-3 text-xs text-[var(--ff-text-tertiary)]">
          <span>BOQ: <span className="text-[var(--ff-text-secondary)]">{selected.boqQty.toLocaleString()} {selected.uom}</span></span>
          <span>Ordered: <span className="text-[var(--ff-text-secondary)]">{selected.orderedQty.toLocaleString()}</span></span>
          <span>Outstanding: <span className={statusColor(selected)}>{selected.outstandingQty.toLocaleString()}</span></span>
        </div>
      )}

      {isOpen && !selected && typeof document !== 'undefined' &&
        createPortal(dropdownContent, document.body)}
    </div>
  );
}
