'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, X, TrendingUp, Clock, Users, Briefcase, User, Building } from 'lucide-react';
import { useGlobalSearch, type SearchResult } from '@/hooks/useGlobalSearch';
import { useRouter } from 'next/navigation';

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  
  const {
    query,
    setQuery,
    results,
    suggestions,
    popularSearches,
    loading,
    error,
    clearSearch
  } = useGlobalSearch();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
        setShowResults(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      // Escape to close
      if (e.key === 'Escape') {
        setShowResults(false);
        if (isOpen) {
          setIsOpen(false);
          clearSearch();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, clearSearch]);

  const handleResultClick = (result: SearchResult) => {
    // Navigate based on result type
    switch (result.type) {
      case 'project':
        router.push(`/projects/${result.id}`);
        break;
      case 'staff':
        router.push(`/staff/${result.id}`);
        break;
      case 'client':
        router.push(`/clients/${result.id}`);
        break;
      case 'contractor':
        router.push(`/contractors/${result.id}`);
        break;
    }
    setShowResults(false);
    clearSearch();
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'project': return <Briefcase className="w-4 h-4" />;
      case 'staff': return <Users className="w-4 h-4" />;
      case 'client': return <Building className="w-4 h-4" />;
      case 'contractor': return <User className="w-4 h-4" />;
      default: return <Search className="w-4 h-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'project': return 'bg-blue-500/20 text-blue-400';
      case 'staff': return 'bg-green-500/20 text-green-400';
      case 'client': return 'bg-purple-500/20 text-purple-400';
      case 'contractor': return 'bg-orange-500/20 text-orange-400';
      default: return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]';
    }
  };

  return (
    <div className="relative" ref={searchRef}>
      {/* Search Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setShowResults(true)}
          placeholder="Search projects, staff, clients... (⌘K)"
          className="w-full md:w-80 pl-10 pr-10 py-2.5 bg-[var(--ff-surface-secondary)] text-[var(--ff-text-primary)] rounded-lg border border-[var(--ff-border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-transparent placeholder-[var(--ff-text-tertiary)] transition-all"
        />
        <Search className="absolute left-3 top-3 w-4 h-4 text-[var(--ff-text-tertiary)]" />
        {query && (
          <button
            onClick={() => {
              clearSearch();
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-3 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (query || popularSearches.length > 0) && (
        <div className="absolute top-full mt-2 w-full md:w-[500px] bg-[var(--ff-surface-primary)] rounded-lg shadow-xl border border-[var(--ff-border-primary)] overflow-hidden z-50 max-h-[600px] overflow-y-auto">
          
          {/* Loading State */}
          {loading && (
            <div className="p-4 text-center text-[var(--ff-text-secondary)]">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--ff-primary)]"></div>
              <p className="mt-2 text-sm">Searching...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="p-4 text-center text-red-500">
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Search Results */}
          {!loading && !error && results.length > 0 && (
            <div className="py-2">
              <div className="px-4 py-2 text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Results ({results.length})
              </div>
              {results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full px-4 py-3 hover:bg-[var(--ff-surface-secondary)] flex items-start gap-3 transition-colors"
                >
                  <div className={`mt-0.5 p-1.5 rounded-md ${getTypeColor(result.type)}`}>
                    {getIcon(result.type)}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-[var(--ff-text-primary)]">
                      {result.title}
                    </div>
                    {result.description && (
                      <div className="text-sm text-[var(--ff-text-secondary)] mt-0.5">
                        {result.description}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeColor(result.type)}`}>
                        {getTypeLabel(result.type)}
                      </span>
                      <span className="text-xs text-[var(--ff-text-tertiary)]">
                        Relevance: {(result.relevance * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {!loading && suggestions.length > 0 && (
            <div className="border-t border-[var(--ff-border-primary)] py-2">
              <div className="px-4 py-2 text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                Suggestions
              </div>
              <div className="px-4 space-y-1">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => setQuery(suggestion)}
                    className="block w-full text-left px-2 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded transition-colors"
                  >
                    <Search className="inline w-3 h-3 mr-2" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Popular Searches (when no query) */}
          {!query && popularSearches.length > 0 && (
            <div className="py-2">
              <div className="px-4 py-2 text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                <TrendingUp className="inline w-3 h-3 mr-1" />
                Popular Searches
              </div>
              <div className="px-4 space-y-1">
                {popularSearches.slice(0, 5).map((search, index) => (
                  <button
                    key={index}
                    onClick={() => setQuery(search)}
                    className="block w-full text-left px-2 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-surface-secondary)] rounded transition-colors"
                  >
                    <Clock className="inline w-3 h-3 mr-2" />
                    {search}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No Results */}
          {!loading && !error && query && results.length === 0 && (
            <div className="p-8 text-center">
              <Search className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">No results found for &quot;{query}&quot;</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-2">
                Try searching with different keywords
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-[var(--ff-border-primary)] px-4 py-2 bg-[var(--ff-surface-secondary)]">
            <div className="flex items-center justify-between text-xs text-[var(--ff-text-tertiary)]">
              <div className="flex items-center gap-4">
                <span>Press <kbd className="px-1.5 py-0.5 bg-[var(--ff-surface-primary)] rounded border border-[var(--ff-border-primary)]">↵</kbd> to select</span>
                <span>Press <kbd className="px-1.5 py-0.5 bg-[var(--ff-surface-primary)] rounded border border-[var(--ff-border-primary)]">ESC</kbd> to close</span>
              </div>
              <span>Powered by PostgreSQL Full-Text Search</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}