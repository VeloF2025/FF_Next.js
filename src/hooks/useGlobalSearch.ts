import { useState, useCallback, useEffect } from 'react';
import { useDebounce } from './useDebounce';
import { log } from '@/lib/logger';

export interface SearchResult {
  type: 'project' | 'staff' | 'client' | 'contractor';
  id: string;
  title: string;
  description: string;
  relevance: number;
}

interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  suggestions: string[];
  popular: string[];
  total: number;
}

export function useGlobalSearch(initialQuery = '') {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [popularSearches, setPopularSearches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Debounce search query to avoid too many API calls
  const debouncedQuery = useDebounce(query, 300);

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setResults([]);
      setSuggestions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      
      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data: SearchResponse = await response.json();
      
      if (data.success) {
        setResults(data.results);
        setSuggestions(data.suggestions);
        setPopularSearches(data.popular);
      } else {
        throw new Error(data.error || 'Search failed');
      }
    } catch (err) {
      log.error('Search error', { error: err }, 'useGlobalSearch');
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-search when debounced query changes
  useEffect(() => {
    if (debouncedQuery) {
      search(debouncedQuery);
    } else {
      setResults([]);
      setSuggestions([]);
    }
  }, [debouncedQuery, search]);

  // Get popular searches on mount
  useEffect(() => {
    fetch('/api/search?q=&popular=true')
      .then(res => res.json())
      .then(data => {
        if (data.popular) {
          setPopularSearches(data.popular);
        }
      })
      .catch(err => log.error('Failed to load popular searches', err, 'useGlobalSearch'));
  }, []);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setSuggestions([]);
    setError(null);
  }, []);

  return {
    query,
    setQuery,
    results,
    suggestions,
    popularSearches,
    loading,
    error,
    search,
    clearSearch
  };
}

// Debounce hook (if not already exists)
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}