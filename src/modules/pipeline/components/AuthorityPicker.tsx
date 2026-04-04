/**
 * Authority Picker Component
 * Searchable dropdown for selecting service authorities
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  X,
  Building2,
  User,
  Mail,
  Phone,
  Clock,
  DollarSign,
  Plus,
  Check,
  MapPin,
  ChevronDown,
} from 'lucide-react';
import type { ServiceAuthoritySearchResult, ServiceAuthority } from '../types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface AuthorityPickerProps {
  /** The approval type ID to filter authorities */
  approvalTypeId: string;
  /** The approval type name for display */
  approvalTypeName?: string;
  /** Optional province filter */
  province?: string;
  /** Optional municipality filter */
  municipality?: string;
  /** Currently selected authority */
  value?: ServiceAuthority | null;
  /** Callback when authority is selected */
  onChange: (authority: ServiceAuthority | null) => void;
  /** Optional placeholder text */
  placeholder?: string;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Show add new option */
  allowCreate?: boolean;
  /** Callback when user wants to add new authority */
  onCreateNew?: () => void;
}

export function AuthorityPicker({
  approvalTypeId,
  approvalTypeName,
  province,
  municipality,
  value,
  onChange,
  placeholder = 'Search for authority...',
  disabled = false,
  allowCreate = false,
  onCreateNew,
}: AuthorityPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ServiceAuthoritySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search authorities
  const searchAuthorities = useCallback(async (query: string) => {
    if (!approvalTypeId && !query) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (approvalTypeId) params.set('approval_type_id', approvalTypeId);
      if (query) params.set('q', query);
      if (province) params.set('province', province);
      if (municipality) params.set('municipality', municipality);
      params.set('limit', '10');

      const response = await fetch(`/api/pipeline/authorities/search?${params}`);
      if (!response.ok) throw new Error('Failed to search authorities');

      const data = await response.json();
      setResults(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [approvalTypeId, province, municipality]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (isOpen) {
      searchTimeoutRef.current = setTimeout(() => {
        searchAuthorities(search);
      }, 300);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search, isOpen, searchAuthorities]);

  // Load initial results when opening
  useEffect(() => {
    if (isOpen && results.length === 0 && !loading) {
      searchAuthorities('');
    }
  }, [isOpen, results.length, loading, searchAuthorities]);

  function handleSelect(authority: ServiceAuthoritySearchResult) {
    // Convert search result to full authority type
    const fullAuthority: ServiceAuthority = {
      id: authority.id,
      approval_type_id: approvalTypeId,
      province: authority.province,
      municipality: authority.municipality,
      region: null,
      authority_name: authority.authority_name,
      department: authority.department,
      contact_name: authority.contact_name,
      contact_title: null,
      contact_email: authority.contact_email,
      contact_phone: authority.contact_phone,
      contact_mobile: null,
      physical_address: null,
      postal_address: null,
      office_hours: null,
      website: null,
      typical_turnaround_days: authority.typical_turnaround_days,
      application_fee: authority.application_fee,
      notes: null,
      is_active: true,
      verified_at: null,
      verified_by: null,
      created_at: '',
      created_by: null,
      updated_at: '',
      updated_by: null,
    };
    onChange(fullAuthority);
    setIsOpen(false);
    setSearch('');
  }

  function handleClear() {
    onChange(null);
    setSearch('');
  }

  function handleOpen() {
    if (!disabled) {
      setIsOpen(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected Value Display / Trigger */}
      {value ? (
        <div
          className={`flex items-start gap-3 p-3 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] ${
            disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--ff-bg-tertiary)]'
          }`}
          onClick={disabled ? undefined : handleOpen}
        >
          <Building2 className="w-5 h-5 text-[var(--ff-text-secondary)] mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--ff-text-primary)] truncate">
                {value.authority_name}
              </span>
              {!disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                  className="p-1 hover:bg-[var(--ff-bg-primary)] rounded"
                >
                  <X className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                </button>
              )}
            </div>
            {value.department && (
              <p className="text-sm text-[var(--ff-text-secondary)] truncate">
                {value.department}
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-[var(--ff-text-tertiary)]">
              {value.contact_name && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {value.contact_name}
                </span>
              )}
              {value.contact_email && (
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {value.contact_email}
                </span>
              )}
              {value.contact_phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {value.contact_phone}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={handleOpen}
          disabled={disabled}
          className={`w-full flex items-center gap-3 px-4 py-3 border border-[var(--ff-border-light)] rounded-lg text-left ${
            disabled
              ? 'bg-[var(--ff-bg-secondary)] opacity-60 cursor-not-allowed'
              : 'bg-[var(--ff-bg-primary)] hover:border-[var(--ff-border-medium)] cursor-pointer'
          }`}
        >
          <Search className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
          <span className="flex-1 text-[var(--ff-text-tertiary)]">{placeholder}</span>
          <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
        </button>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg overflow-hidden">
          {/* Search Header */}
          <div className="p-3 border-b border-[var(--ff-border-light)]">
            {approvalTypeName && (
              <p className="text-xs text-[var(--ff-text-secondary)] mb-2">
                For: {approvalTypeName}
              </p>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, department, contact..."
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-sm"
              />
              {loading && (
                <InlineSpinner size="sm" className="absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto">
            {error && (
              <div className="p-4 text-center text-sm text-red-500">{error}</div>
            )}

            {!loading && !error && results.length === 0 && (
              <div className="p-4 text-center text-sm text-[var(--ff-text-tertiary)]">
                {search ? 'No authorities found' : 'Start typing to search...'}
              </div>
            )}

            {results.map((authority) => (
              <button
                key={authority.id}
                onClick={() => handleSelect(authority)}
                className="w-full p-3 text-left hover:bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] last:border-b-0 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[var(--ff-text-primary)] truncate">
                      {authority.authority_name}
                    </div>
                    {authority.department && (
                      <p className="text-sm text-[var(--ff-text-secondary)] truncate">
                        {authority.department}
                      </p>
                    )}

                    {/* Location */}
                    {(authority.municipality || authority.province) && (
                      <p className="text-xs text-[var(--ff-text-tertiary)] flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3" />
                        {[authority.municipality, authority.province].filter(Boolean).join(', ')}
                      </p>
                    )}

                    {/* Contact Info */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[var(--ff-text-secondary)]">
                      {authority.contact_name && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {authority.contact_name}
                        </span>
                      )}
                      {authority.contact_email && (
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {authority.contact_email}
                        </span>
                      )}
                      {authority.contact_phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {authority.contact_phone}
                        </span>
                      )}
                    </div>

                    {/* Processing Info */}
                    <div className="flex gap-4 mt-2 text-xs text-[var(--ff-text-tertiary)]">
                      {authority.typical_turnaround_days && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          ~{authority.typical_turnaround_days} days
                        </span>
                      )}
                      {authority.application_fee && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />
                          R{authority.application_fee.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-transparent group-hover:text-green-500 flex-shrink-0" />
                </div>
              </button>
            ))}
          </div>

          {/* Add New Option */}
          {allowCreate && onCreateNew && (
            <div className="p-2 border-t border-[var(--ff-border-light)]">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onCreateNew();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add New Authority
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AuthorityPicker;
