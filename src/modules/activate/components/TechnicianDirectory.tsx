/**
 * Technician Directory Component
 * 
 * Lists field technicians (activators and installers) with their performance metrics.
 * Can discover new technicians from WhatsApp and OneMap data.
 * 
 * @author Jarvis
 * @date 2026-02-01
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  RefreshCw,
  Download,
  CheckCircle,
  XCircle,
  Phone,
  MessageSquare,
  TrendingUp,
  Target,
  BarChart3,
  Zap,
  Eye,
  Pencil,
  X,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/shared/components/ui/Input';
import { Badge } from '@/shared/components/ui/Badge';
import { formatDisplayDate } from '@/utils/dateFormat';
import type {
  TechnicianSummary,
  ActivatorSummary,
  InstallerSummary,
  DiscoveredTechnician,
  TechnicianType
} from '@/types/technician.types';
import { isActivator, isInstaller } from '@/types/technician.types';

interface TechnicianDirectoryProps {
  onViewTechnician?: (id: string) => void;
}

export function TechnicianDirectory({ onViewTechnician }: TechnicianDirectoryProps) {
  const [technicians, setTechnicians] = useState<TechnicianSummary[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredTechnician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<'directory' | 'discover'>('directory');
  const [typeFilter, setTypeFilter] = useState<TechnicianType | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTechnician, setEditingTechnician] = useState<TechnicianSummary | null>(null);

  const fetchTechnicians = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ includeStats: 'true' });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (searchTerm) params.set('search', searchTerm);
      
      const response = await fetch(`/api/technicians?${params}`);
      if (!response.ok) throw new Error('Failed to fetch technicians');
      
      const result = await response.json();
      // API returns { success: true, data: { technicians: [...] } }
      const data = result.data || result;
      setTechnicians(data.technicians || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [typeFilter, searchTerm]);

  const discoverTechnicians = useCallback(async () => {
    setIsDiscovering(true);
    try {
      const response = await fetch('/api/technicians/discover?source=all');
      if (!response.ok) throw new Error('Failed to discover technicians');
      
      const result = await response.json();
      const data = result.data || result;
      setDiscovered(data.discovered || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  useEffect(() => {
    fetchTechnicians();
  }, [fetchTechnicians]);

  const handleImportSelected = async (selected: DiscoveredTechnician[]) => {
    try {
      const toImport = selected.map(d => ({
        identifier: d.identifier,
        source: d.source,
        name: d.sampleName || `Tech ${d.identifier.slice(-6)}`,
        type: d.source === 'whatsapp' ? 'activator' : 'installer',
        projects: d.projects,
      }));

      const response = await fetch('/api/technicians/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicians: toImport }),
      });

      if (!response.ok) throw new Error('Failed to import');
      
      const data = await response.json();
      alert(`Imported ${data.summary.imported} technicians`);
      
      fetchTechnicians();
      discoverTechnicians();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const stats = {
    total: technicians.length,
    activators: technicians.filter(t => t.type === 'activator').length,
    installers: technicians.filter(t => t.type === 'installer').length,
    activeToday: technicians.filter(t => t.lastActiveDate && 
      new Date(t.lastActiveDate).toDateString() === new Date().toDateString()).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Technician Directory
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Field technicians who submit activation photos and perform installations
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={fetchTechnicians} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowAddModal(true)}>
            <UserPlus className="w-4 h-4 mr-2" />
            Add Technician
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Total</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</div>
        </div>
        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-green-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Activators</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.activators}</div>
        </div>
        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-orange-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Installers</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.installers}</div>
        </div>
        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-purple-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Active Today</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.activeToday}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[var(--ff-bg-secondary)] rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('directory')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'directory'
              ? 'bg-blue-500 text-white'
              : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
          }`}
        >
          Directory ({technicians.length})
        </button>
        <button
          onClick={() => {
            setActiveTab('discover');
            if (discovered.length === 0) discoverTechnicians();
          }}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'discover'
              ? 'bg-blue-500 text-white'
              : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
          }`}
        >
          Discover New
          {discovered.length > 0 && (
            <Badge className="ml-2" variant="secondary">{discovered.length}</Badge>
          )}
        </button>
      </div>

      {/* Filters */}
      {activeTab === 'directory' && (
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <Input
              placeholder="Search by name, phone, contractor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TechnicianType | 'all')}
            className="px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
          >
            <option value="all">All Types</option>
            <option value="activator">Activators</option>
            <option value="installer">Installers</option>
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Directory Tab Content */}
      {activeTab === 'directory' && (
        <div className="ff-card overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <LoadingSpinner size="lg" label="Loading technicians..." />
            </div>
          ) : technicians.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
                No Technicians Found
              </h3>
              <p className="text-[var(--ff-text-secondary)] mb-4">
                Add technicians manually or discover them from WhatsApp/OneMap data.
              </p>
              <Button onClick={() => setActiveTab('discover')}>
                Discover Technicians
              </Button>
            </div>
          ) : (
            <table className="min-w-full">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Technician
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Type
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    {typeFilter === 'installer' ? 'Installations' : typeFilter === 'activator' ? 'Submissions' : 'Activity'}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    {typeFilter === 'installer' ? 'QA Pass Rate' : 'First Pass'}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    {typeFilter === 'installer' ? 'Rework Rate' : 'Serial Compliance'}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {technicians.map((tech) => (
                  <TechnicianRow
                    key={tech.id}
                    tech={tech}
                    onEdit={() => setEditingTechnician(tech)}
                    onView={() => onViewTechnician?.(tech.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Discover Tab Content */}
      {activeTab === 'discover' && (
        <DiscoverSection
          discovered={discovered}
          isLoading={isDiscovering}
          onRefresh={discoverTechnicians}
          onImport={handleImportSelected}
        />
      )}

      {/* Edit Modal */}
      {editingTechnician && (
        <EditTechnicianModal
          technician={editingTechnician}
          onClose={() => setEditingTechnician(null)}
          onSave={async (updated) => {
            await fetchTechnicians();
            setEditingTechnician(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Helper component to render a technician row with type-specific stats
 */
function TechnicianRow({
  tech,
  onEdit,
  onView,
}: {
  tech: TechnicianSummary;
  onEdit: () => void;
  onView: () => void;
}) {
  // Render activator-specific stats
  if (isActivator(tech)) {
    return (
      <tr className="hover:bg-[var(--ff-bg-hover)]">
        <td className="px-4 py-3">
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">{tech.name}</p>
            {tech.phone && (
              <p className="text-xs text-[var(--ff-text-secondary)] flex items-center gap-1">
                <Phone className="w-3 h-3" /> {tech.phone}
              </p>
            )}
            {tech.contractor && (
              <p className="text-xs text-[var(--ff-text-tertiary)]">{tech.contractor}</p>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <Badge variant="success">activator</Badge>
        </td>
        <td className="px-4 py-3 text-center">
          <span className="font-medium text-[var(--ff-text-primary)]">
            {tech.totalSubmissions}
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          <span className={`font-medium ${
            tech.firstPassRate >= 85 ? 'text-green-500' :
            tech.firstPassRate >= 70 ? 'text-yellow-500' : 'text-red-500'
          }`}>
            {tech.firstPassRate}%
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          <span className={`font-medium ${
            tech.serialComplianceRate >= 95 ? 'text-green-500' :
            tech.serialComplianceRate >= 80 ? 'text-yellow-500' : 'text-red-500'
          }`}>
            {tech.serialComplianceRate}%
          </span>
        </td>
        <td className="px-4 py-3">
          <Badge variant={tech.status === 'active' ? 'success' : 'secondary'}>
            {tech.status}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit} title="Edit technician">
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onView} title="View details">
              <Eye className="w-4 h-4" />
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  // Render installer-specific stats
  if (isInstaller(tech)) {
    return (
      <tr className="hover:bg-[var(--ff-bg-hover)]">
        <td className="px-4 py-3">
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">{tech.name}</p>
            {tech.phone && (
              <p className="text-xs text-[var(--ff-text-secondary)] flex items-center gap-1">
                <Phone className="w-3 h-3" /> {tech.phone}
              </p>
            )}
            {tech.contractor && (
              <p className="text-xs text-[var(--ff-text-tertiary)]">{tech.contractor}</p>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <Badge variant="warning">installer</Badge>
        </td>
        <td className="px-4 py-3 text-center">
          <span className="font-medium text-[var(--ff-text-primary)]">
            {tech.totalInstallations}
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          {/* QA Pass Rate: Green ≥90%, Yellow 75-90%, Red <75% */}
          <span className={`font-medium ${
            tech.qaPassRate >= 90 ? 'text-green-500' :
            tech.qaPassRate >= 75 ? 'text-yellow-500' : 'text-red-500'
          }`}>
            {tech.qaPassRate}%
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          {/* Rework Rate: Inverse - Green ≤5%, Yellow 5-15%, Red >15% */}
          <span className={`font-medium ${
            tech.reworkRate <= 5 ? 'text-green-500' :
            tech.reworkRate <= 15 ? 'text-yellow-500' : 'text-red-500'
          }`}>
            {tech.reworkRate}%
          </span>
        </td>
        <td className="px-4 py-3">
          <Badge variant={tech.status === 'active' ? 'success' : 'secondary'}>
            {tech.status}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit} title="Edit technician">
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onView} title="View details">
              <Eye className="w-4 h-4" />
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  // Fallback (should never hit)
  return null;
}

interface EditTechnicianModalProps {
  technician: TechnicianSummary;
  onClose: () => void;
  onSave: (technician: Partial<TechnicianSummary>) => void;
}

function EditTechnicianModal({ technician, onClose, onSave }: EditTechnicianModalProps) {
  const [formData, setFormData] = useState({
    name: technician.name || '',
    type: technician.type || 'activator',
    contractor: technician.contractor || '',
    status: technician.status || 'active',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/technicians', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: technician.id,
          name: formData.name || null,
          type: formData.type,
          contractor: formData.contractor || null,
          status: formData.status,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update technician');
      }

      onSave({ ...technician, ...formData });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--ff-bg-primary)] rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Edit Technician
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Phone (read-only) */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Phone / WhatsApp ID
            </label>
            <div className="px-3 py-2 bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-tertiary)] text-sm">
              {technician.phone || 'N/A'}
            </div>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              This is the identifier from WhatsApp submissions
            </p>
          </div>

          {/* Formal Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Formal Name
            </label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Enter the technician's real name"
            />
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Map this phone/ID to a human-readable name
            </p>
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Type
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as TechnicianType })}
              className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
            >
              <option value="activator">Activator</option>
              <option value="installer">Installer</option>
            </select>
          </div>

          {/* Contractor/Team */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Contractor / Team
            </label>
            <Input
              value={formData.contractor}
              onChange={(e) => setFormData({ ...formData, contractor: e.target.value })}
              placeholder="e.g., ACME Installations"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Status
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
              className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <InlineSpinner size="sm" className="mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DiscoverSectionProps {
  discovered: DiscoveredTechnician[];
  isLoading: boolean;
  onRefresh: () => void;
  onImport: (selected: DiscoveredTechnician[]) => void;
}

function DiscoverSection({ discovered, isLoading, onRefresh, onImport }: DiscoverSectionProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const selectAll = () => {
    if (selected.size === discovered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(discovered.map(d => d.identifier)));
    }
  };

  const handleImport = () => {
    const toImport = discovered.filter(d => selected.has(d.identifier));
    onImport(toImport);
  };

  if (isLoading) {
    return (
      <div className="ff-card p-8 text-center">
        <LoadingSpinner size="lg" label="Discovering technicians from WhatsApp and OneMap..." />
      </div>
    );
  }

  if (discovered.length === 0) {
    return (
      <div className="ff-card p-8 text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
          All Caught Up!
        </h3>
        <p className="text-[var(--ff-text-secondary)]">
          No new technicians found. All active senders are already in the directory.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Found <span className="font-medium text-[var(--ff-text-primary)]">{discovered.length}</span> technicians 
          not yet in the directory
        </p>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={handleImport} disabled={selected.size === 0}>
            <Download className="w-4 h-4 mr-2" />
            Import Selected ({selected.size})
          </Button>
        </div>
      </div>

      <div className="ff-card overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selected.size === discovered.length}
                  onChange={selectAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Identifier
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Source
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Submissions
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Projects
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Last Seen
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {discovered.map((tech) => (
              <tr 
                key={tech.identifier} 
                className={`hover:bg-[var(--ff-bg-hover)] ${selected.has(tech.identifier) ? 'bg-blue-500/10' : ''}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(tech.identifier)}
                    onChange={() => toggleSelect(tech.identifier)}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--ff-text-primary)]">
                    {tech.sampleName || tech.identifier.slice(-10)}
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">{tech.identifier}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={tech.source === 'whatsapp' ? 'success' : 'warning'}>
                    {tech.source === 'whatsapp' ? 'WhatsApp' : 'OneMap'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-center font-medium text-[var(--ff-text-primary)]">
                  {tech.submissionCount}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {tech.projects.slice(0, 3).map(p => (
                      <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                    ))}
                    {tech.projects.length > 3 && (
                      <Badge variant="secondary" className="text-xs">+{tech.projects.length - 3}</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
                  {tech.lastSeen ? formatDisplayDate(tech.lastSeen) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TechnicianDirectory;
