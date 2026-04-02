/**
 * Sage Site-to-Project Mapping & Business Unit Display
 *
 * Two sections:
 * 1. Sites → FF Projects mapping (with auto-match and manual dropdowns)
 * 2. Business Units (read-only display)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  MapPin,
  Building2,
  RefreshCw,
  Wand2,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Unlink,
} from 'lucide-react';

interface SiteMapping {
  id: string;
  sage_category_id: string;
  site_name: string;
  is_active: boolean;
  mapping_status: string;
  ff_project_id: string | null;
  project_name: string | null;
  project_status: string | null;
}

/** Slim project option for Sage site-to-project mapping dropdown */
interface ProjectOption {
  id: string;
  name: string;
  status: string;
}

interface BusinessUnit {
  id: string;
  sage_category_id: string;
  bu_name: string;
  is_active: boolean;
  transaction_count: string;
  total_debit: string;
  total_credit: string;
}

export function SageMappingTab() {
  const [sites, setSites] = useState<SiteMapping[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, mapped: 0, unmapped: 0 });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [sitesRes, buRes] = await Promise.all([
        fetch('/api/sage/mappings/sites'),
        fetch('/api/sage/mappings/business-units'),
      ]);

      const sitesData = await sitesRes.json();
      const buData = await buRes.json();

      if (sitesData.success) {
        setSites(sitesData.data.sites || []);
        setProjects(sitesData.data.projects || []);
        setStats(sitesData.data.stats || { total: 0, mapped: 0, unmapped: 0 });
      }

      if (buData.success) {
        setBusinessUnits(buData.data.businessUnits || []);
      }
    } catch (err) {
      setError('Failed to load mapping data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSyncAnalysis = async () => {
    try {
      setSyncing(true);
      setError(null);
      setSuccessMsg(null);

      const res = await fetch('/api/sage/sync/analysis', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        setSuccessMsg(
          `Synced ${data.data.types.total} types and ${data.data.categories.total} categories from Sage`
        );
        await fetchData();
      } else {
        setError(data.error?.message || 'Analysis sync failed');
      }
    } catch (err) {
      setError('Failed to sync analysis data');
    } finally {
      setSyncing(false);
    }
  };

  const handleAutoMatch = async () => {
    try {
      setAutoMatching(true);
      setError(null);
      setSuccessMsg(null);

      const res = await fetch('/api/sage/mappings/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_match' }),
      });
      const data = await res.json();

      if (data.success) {
        setSuccessMsg(`Auto-matched ${data.data.matched} of ${data.data.totalUnmapped} unmapped sites`);
        await fetchData();
      } else {
        setError(data.error?.message || 'Auto-match failed');
      }
    } catch (err) {
      setError('Failed to auto-match sites');
    } finally {
      setAutoMatching(false);
    }
  };

  const handleMappingChange = async (sageCategoryId: string, projectId: string | null) => {
    try {
      setSavingId(sageCategoryId);
      setError(null);

      const res = await fetch('/api/sage/mappings/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sageCategoryId, projectId }),
      });
      const data = await res.json();

      if (data.success) {
        await fetchData();
      } else {
        setError(data.error?.message || 'Failed to update mapping');
      }
    } catch (err) {
      setError('Failed to save mapping');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-text-tertiary)]" />
          <span className="ml-2 text-[var(--ff-text-secondary)]">Loading mappings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Messages */}
      {successMsg && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center">
          <CheckCircle2 className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" />
          <span className="text-green-400">{successMsg}</span>
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center">
          <AlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {/* Site Mappings */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border)]">
        <div className="p-6 border-b border-[var(--ff-border)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <MapPin className="w-5 h-5 text-[var(--ff-accent)] mr-2" />
              <div>
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Site → Project Mapping
                </h3>
                <p className="text-sm text-[var(--ff-text-tertiary)]">
                  {stats.mapped} mapped / {stats.total} total
                  {stats.unmapped > 0 && (
                    <span className="text-yellow-500 ml-2">
                      ({stats.unmapped} unmapped)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleSyncAnalysis}
                disabled={syncing}
                className="bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-border)] disabled:opacity-50 text-[var(--ff-text-primary)] px-3 py-2 rounded-lg text-sm transition-colors flex items-center"
              >
                {syncing ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                )}
                Sync from Sage
              </button>
              <button
                onClick={handleAutoMatch}
                disabled={autoMatching || stats.unmapped === 0}
                className="bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm transition-colors flex items-center"
              >
                {autoMatching ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4 mr-1.5" />
                )}
                Auto-Match
              </button>
            </div>
          </div>
        </div>

        {sites.length === 0 ? (
          <div className="p-8 text-center text-[var(--ff-text-tertiary)]">
            No sites found. Click &quot;Sync from Sage&quot; to pull analysis data.
          </div>
        ) : (
          <div className="divide-y divide-[var(--ff-border)]">
            {sites.map((site) => (
              <div
                key={site.sage_category_id}
                className="p-4 flex items-center justify-between hover:bg-[var(--ff-bg-tertiary)] transition-colors"
              >
                <div className="flex items-center min-w-0 flex-1">
                  <div
                    className={`w-2 h-2 rounded-full mr-3 flex-shrink-0 ${
                      site.mapping_status === 'mapped'
                        ? 'bg-green-500'
                        : 'bg-yellow-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                      {site.site_name}
                    </p>
                    {site.mapping_status === 'mapped' && site.project_name && (
                      <p className="text-xs text-green-400 flex items-center mt-0.5">
                        <Check className="w-3 h-3 mr-1" />
                        {site.project_name}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 ml-4">
                  <select
                    value={site.ff_project_id || ''}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      handleMappingChange(site.sage_category_id, val);
                    }}
                    disabled={savingId === site.sage_category_id}
                    className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--ff-text-primary)] max-w-[250px] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  >
                    <option value="">-- Select Project --</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {savingId === site.sage_category_id && (
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-accent)]" />
                  )}

                  {site.ff_project_id && (
                    <button
                      onClick={() => handleMappingChange(site.sage_category_id, null)}
                      disabled={savingId === site.sage_category_id}
                      className="text-[var(--ff-text-tertiary)] hover:text-red-400 p-1 transition-colors"
                      title="Remove mapping"
                    >
                      <Unlink className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Business Units */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border)]">
        <div className="p-6 border-b border-[var(--ff-border)]">
          <div className="flex items-center">
            <Building2 className="w-5 h-5 text-[var(--ff-accent)] mr-2" />
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Business Units
              </h3>
              <p className="text-sm text-[var(--ff-text-tertiary)]">
                {businessUnits.length} units from Sage
              </p>
            </div>
          </div>
        </div>

        {businessUnits.length === 0 ? (
          <div className="p-8 text-center text-[var(--ff-text-tertiary)]">
            No business units found. Sync analysis data first.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border)]">
                  <th className="text-left p-4 text-[var(--ff-text-tertiary)] font-medium">
                    Business Unit
                  </th>
                  <th className="text-right p-4 text-[var(--ff-text-tertiary)] font-medium">
                    Transactions
                  </th>
                  <th className="text-right p-4 text-[var(--ff-text-tertiary)] font-medium">
                    Total Debit
                  </th>
                  <th className="text-right p-4 text-[var(--ff-text-tertiary)] font-medium">
                    Total Credit
                  </th>
                  <th className="text-center p-4 text-[var(--ff-text-tertiary)] font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border)]">
                {businessUnits.map((bu) => (
                  <tr
                    key={bu.sage_category_id}
                    className="hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    <td className="p-4 text-[var(--ff-text-primary)] font-medium">
                      {bu.bu_name}
                    </td>
                    <td className="p-4 text-right text-[var(--ff-text-secondary)]">
                      {parseInt(bu.transaction_count).toLocaleString()}
                    </td>
                    <td className="p-4 text-right text-[var(--ff-text-secondary)]">
                      R {parseFloat(bu.total_debit).toLocaleString('en-ZA', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-4 text-right text-[var(--ff-text-secondary)]">
                      R {parseFloat(bu.total_credit).toLocaleString('en-ZA', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-4 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          bu.is_active
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-gray-500/10 text-gray-400'
                        }`}
                      >
                        {bu.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
