'use client';

/**
 * Staff Search Select Component
 *
 * Dropdown with search for selecting active staff members.
 * Shows name, department, and license status.
 * Uses /api/fleet/available-drivers endpoint.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, User, Loader2, ChevronDown, X, AlertCircle, CheckCircle } from 'lucide-react';

interface AvailableStaff {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  hasValidLicense: boolean;
  licenseExpiry: string | null;
  hasVehicle: boolean;
  currentVehicleReg: string | null;
}

interface StaffSearchSelectProps {
  /** Currently selected staff ID */
  value: string | null;
  /** Called when staff is selected */
  onChange: (staffId: string | null, staff: AvailableStaff | null) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Filter to only show staff with valid license */
  onlyWithLicense?: boolean;
  /** Disable the select */
  disabled?: boolean;
  /** Show license status indicator */
  showLicenseStatus?: boolean;
  /** Custom class name */
  className?: string;
}

export function StaffSearchSelect({
  value,
  onChange,
  placeholder = 'Search for staff member...',
  onlyWithLicense = false,
  disabled = false,
  showLicenseStatus = true,
  className = '',
}: StaffSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allStaff, setAllStaff] = useState<AvailableStaff[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<AvailableStaff | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch staff list
  useEffect(() => {
    async function fetchStaff() {
      setLoading(true);
      try {
        const res = await fetch('/api/fleet/available-drivers');
        if (!res.ok) throw new Error('Failed to fetch staff');
        const data = await res.json();
        setAllStaff(data.data.drivers);

        // If value is set, find the staff
        if (value) {
          const found = data.data.drivers.find((s: AvailableStaff) => s.id === value);
          if (found) setSelectedStaff(found);
        }
      } catch (error) {
        console.error('Failed to fetch staff:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStaff();
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter staff based on search and license filter
  const filteredStaff = allStaff.filter((staff) => {
    // License filter
    if (onlyWithLicense && !staff.hasValidLicense) return false;

    // Search filter
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      staff.name.toLowerCase().includes(query) ||
      (staff.department && staff.department.toLowerCase().includes(query)) ||
      (staff.email && staff.email.toLowerCase().includes(query))
    );
  });

  // Handle selection
  const handleSelect = useCallback((staff: AvailableStaff) => {
    setSelectedStaff(staff);
    onChange(staff.id, staff);
    setIsOpen(false);
    setSearchQuery('');
  }, [onChange]);

  // Handle clear
  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStaff(null);
    onChange(null, null);
    setSearchQuery('');
  }, [onChange]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Selected value or search input */}
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            if (!isOpen) {
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }
        }}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-3 py-2.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-left transition-colors ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-[var(--ff-primary)] focus:ring-2 focus:ring-[var(--ff-primary)]'
        }`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedStaff ? (
            <>
              <User className="w-4 h-4 text-[var(--ff-text-tertiary)] shrink-0" />
              <span className="text-[var(--ff-text-primary)] truncate">
                {selectedStaff.name}
              </span>
              {showLicenseStatus && (
                selectedStaff.hasValidLicense ? (
                  <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                )
              )}
            </>
          ) : (
            <span className="text-[var(--ff-text-tertiary)]">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedStaff && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 hover:bg-[var(--ff-bg-primary)] rounded"
            >
              <X className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-[var(--ff-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl max-h-80 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-[var(--ff-border-light)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or department..."
                className="w-full pl-9 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-1 focus:ring-[var(--ff-primary)]"
              />
            </div>
          </div>

          {/* Staff list */}
          <div className="max-h-60 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-[var(--ff-text-tertiary)] animate-spin" />
              </div>
            ) : filteredStaff.length === 0 ? (
              <div className="py-6 text-center">
                <User className="w-8 h-8 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {searchQuery ? 'No staff found' : 'No active staff available'}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {filteredStaff.map((staff) => (
                  <button
                    key={staff.id}
                    type="button"
                    onClick={() => handleSelect(staff)}
                    className={`w-full px-3 py-2.5 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors ${
                      selectedStaff?.id === staff.id ? 'bg-[var(--ff-bg-tertiary)]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                          {staff.name}
                        </p>
                        <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                          {staff.department || 'No department'}
                        </p>
                      </div>
                      {showLicenseStatus && (
                        <div className="shrink-0 text-right">
                          {staff.hasValidLicense ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded text-xs">
                              <CheckCircle className="w-3 h-3" />
                              Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded text-xs">
                              <AlertCircle className="w-3 h-3" />
                              No License
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
