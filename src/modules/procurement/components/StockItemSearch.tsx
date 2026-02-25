/**
 * StockItemSearch - Typeahead search for stock items
 * Searches /api/procurement/stock-items-search and auto-fills item details.
 * Dropdown is portaled to document.body to escape overflow:hidden/auto containers.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, PlusCircle } from 'lucide-react';
import { log } from '@/lib/logger';
import { AddStockItemModal } from './AddStockItemModal';

interface StockItemResult {
  id: string;
  item_code: string;
  name: string;
  description: string | null;
  category: string;
  uom: string;
}

interface StockItemSearchProps {
  value: string;
  onSelect: (item: StockItemResult) => void;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function StockItemSearch({
  value,
  onSelect,
  onChange,
  placeholder = 'Search or type item description...',
  className = '',
}: StockItemSearchProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<StockItemResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync external value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Update portal position whenever dropdown opens or window scrolls/resizes
  useEffect(() => {
    if (!isOpen || !inputRef.current) return;

    const updatePos = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
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

  // Close dropdown when clicking outside (input container or portal dropdown)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Keep open if clicking inside the input container
      if (containerRef.current?.contains(target)) return;
      // Keep open if clicking inside the portal dropdown (data attribute check)
      const dropdownEl = document.querySelector('[data-stock-dropdown]');
      if (dropdownEl?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchItems = async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/procurement/stock-items-search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      const data = await res.json();
      if (data.success && data.data?.items) {
        setResults(data.data.items);
        setIsOpen(true); // open always — either shows results or "Add to catalog"
        setSelectedIndex(-1);
      }
    } catch (err) {
      log.error('Stock item search failed', { error: err });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (newValue: string) => {
    setQuery(newValue);
    onChange(newValue);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchItems(newValue), 300);
  };

  const handleSelect = (item: StockItemResult) => {
    setQuery(item.name);
    setIsOpen(false);
    onSelect(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      const selected = results[selectedIndex];
      if (selected) handleSelect(selected);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    onChange('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const dropdownContent = (
    <div
      data-stock-dropdown
      style={dropdownStyle}
      className="max-h-60 overflow-auto rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-xl"
    >
      {loading ? (
        <div className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)]">Searching...</div>
      ) : results.length === 0 ? (
        <button
          type="button"
          onClick={() => { setIsOpen(false); setShowAddModal(true); }}
          className="w-full text-left px-3 py-2.5 text-sm hover:bg-[var(--ff-bg-hover)] transition-colors flex items-center gap-2 border-b border-[var(--ff-border-light)]"
        >
          <PlusCircle className="h-4 w-4 text-purple-400 shrink-0" />
          <span>
            <span className="text-[var(--ff-text-secondary)]">Add </span>
            <span className="font-medium text-[var(--ff-text-primary)]">&ldquo;{query}&rdquo;</span>
            <span className="text-[var(--ff-text-secondary)]"> to stock catalog</span>
          </span>
        </button>
      ) : (
        <>
          {results.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--ff-bg-hover)] transition-colors ${
                idx === selectedIndex ? 'bg-[var(--ff-bg-hover)]' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-[var(--ff-text-primary)] truncate">{item.name}</span>
                <span className="ml-2 text-xs text-[var(--ff-text-tertiary)] shrink-0">{item.uom}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-blue-400">{item.item_code}</span>
                <span className="text-xs text-[var(--ff-text-tertiary)]">{item.category}</span>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setIsOpen(false); setShowAddModal(true); }}
            className="w-full text-left px-3 py-2 text-xs text-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-hover)] border-t border-[var(--ff-border-light)] flex items-center gap-1.5 transition-colors"
          >
            <PlusCircle className="h-3.5 w-3.5 text-purple-400" />
            Not listed? Add to catalog
          </button>
        </>
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
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full pl-7 pr-7 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${className}`}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}

      {showAddModal && typeof document !== 'undefined' && (
        <AddStockItemModal
          initialName={query}
          onClose={() => setShowAddModal(false)}
          onCreated={(item) => {
            setShowAddModal(false);
            handleSelect(item);
          }}
        />
      )}
    </div>
  );
}
