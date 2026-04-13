/**
 * Search Bar Component
 * 
 * Real-time search functionality for the help center
 */

import React, { useState, useEffect } from 'react';
import { Search, X, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import type { SearchResult } from '../data/manual-content';

interface SearchBarProps {
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  onSearchChange: (query: string) => void;
  onResultClick: (sectionId: string, subsectionId?: string) => void;
  onClearSearch: () => void;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  searchQuery,
  searchResults,
  isSearching,
  onSearchChange,
  onResultClick,
  onClearSearch,
  className
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Show results when there's a query and we're focused, or when there are results
  useEffect(() => {
    setShowResults(
      (isFocused && searchQuery.trim().length > 0) || 
      (searchQuery.trim().length > 0 && searchResults.length > 0)
    );
  }, [isFocused, searchQuery, searchResults.length]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onSearchChange(value);
  };

  const handleClear = () => {
    onSearchChange('');
    onClearSearch();
    setShowResults(false);
  };

  const handleResultClick = (result: SearchResult) => {
    onResultClick(result.sectionId, result.subsectionId);
    setShowResults(false);
    setIsFocused(false);
  };

  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;
    
    const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);
    let highlightedText = text;
    
    searchTerms.forEach(term => {
      const regex = new RegExp(`(${term})`, 'gi');
      highlightedText = highlightedText.replace(regex, '**$1**');
    });
    
    return highlightedText.split('**').map((part, index) => {
      if (index % 2 === 1) {
        return (
          <mark key={index} className="bg-yellow-500/30 text-[var(--ff-text-primary)] px-0.5 rounded">
            {part}
          </mark>
        );
      }
      return part;
    });
  };

  return (
    <div className={cn('relative', className)}>
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
        </div>
        
        <input
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder="Search the manual..."
          className={cn(
            'block w-full pl-10 pr-10 py-3 border border-[var(--ff-border-light)] rounded-lg',
            'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]',
            'placeholder-[var(--ff-text-tertiary)]',
            'focus:ring-2 focus:ring-[var(--ff-primary)]/20 focus:border-[var(--ff-primary)]',
            'transition-colors duration-200'
          )}
        />
        
        {searchQuery && (
          <button
            onClick={handleClear}
            className="absolute inset-y-0 right-0 pr-3 flex items-center hover:text-[var(--ff-text-primary)] text-[var(--ff-text-tertiary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {isSearching ? (
            <div className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-[var(--ff-text-tertiary)]">
                <InlineSpinner size="sm" />
                <span className="text-sm">Searching...</span>
              </div>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-sm text-[var(--ff-text-tertiary)]">
                No results found for &quot;{searchQuery}&quot;
              </p>
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                Try different keywords or browse the table of contents
              </p>
            </div>
          ) : (
            <div className="py-2">
              <div className="px-3 py-2 border-b border-[var(--ff-border-light)]">
                <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
                </span>
              </div>
              
              {searchResults.slice(0, 10).map((result, index) => (
                <button
                  key={`${result.sectionId}-${result.subsectionId || 'main'}-${index}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full px-3 py-3 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors border-b border-[var(--ff-border-light)] last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                          {result.sectionTitle}
                        </span>
                        {result.subsectionTitle && (
                          <>
                            <ArrowRight className="w-3 h-3 text-[var(--ff-text-tertiary)] flex-shrink-0" />
                            <span className="text-sm text-[var(--ff-text-secondary)] truncate">
                              {result.subsectionTitle}
                            </span>
                          </>
                        )}
                      </div>
                      
                      <p className="text-xs text-[var(--ff-text-tertiary)] line-clamp-3 leading-relaxed">
                        {highlightText(result.matchedText, searchQuery)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
              
              {searchResults.length > 10 && (
                <div className="px-3 py-2 text-center border-t border-[var(--ff-border-light)]">
                  <span className="text-xs text-[var(--ff-text-tertiary)]">
                    Showing first 10 results. Refine your search for more specific results.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};