'use client';

import { useEffect, useMemo } from 'react';
import { ModulePage } from '@/components/module-page';
import { nocConfig } from '@/modules/navigation';
import { TicketList } from '@/modules/noc/components/TicketList/TicketList';
import { TicketGridView } from '@/modules/noc/components/TicketList/TicketGridView';
import { KanbanBoard } from '@/modules/noc/components/KanbanBoard';
import { useMyTeams } from '@/modules/noc/hooks/useMyTeams';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { Search, Users, User, X } from 'lucide-react';
import { TicketSummaryTiles } from '@/modules/noc/components/TicketList/TicketSummaryTiles';
import { useProjects } from '@/hooks/useProjects';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import type { TicketFilters } from '@/modules/noc/types/ticket';

type ViewMode = 'table' | 'kanban' | 'grid';
type TicketScope = 'all' | 'my_tickets' | 'my_team';

// Encoded value: "t:<ticket_type>", "c:<category>", "s:<source>"
type ClassificationValue = '' | `t:${string}` | `c:${string}` | `s:${string}`;

const TableIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const KanbanIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
  </svg>
);

const GridIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h18M3 9h18M3 13h18M3 17h18M8 5v14M16 5v14" />
  </svg>
);

export default function TicketsListPageClient() {
  const { filters: urlFilters, setFilter, setMultiple } = useUrlFilters({
    status: '',
    type: '',
    category: '',
    source: '',
    date: '',
    project: '',
    scope: '',
    view: '',
    search: '',
  });

  const viewMode = (urlFilters.view || 'kanban') as ViewMode;
  const ticketScope = (urlFilters.scope || 'all') as TicketScope;
  const searchTerm = urlFilters.search;
  const filterType = urlFilters.type;
  const filterCategory = urlFilters.category;
  const filterSource = urlFilters.source;
  const filterDatePreset = urlFilters.date;
  const filterProject = urlFilters.project;
  const statusFilter = urlFilters.status || undefined;

  const { teams, teamIds, isLoading: teamsLoading } = useMyTeams();
  const { currentUser } = useAuth();
  const { data: projects = [] } = useProjects();
  const activeProjects = (projects as { id: string; name: string; code?: string; status?: string }[])
    .filter((p) => p.status === 'active' || p.status === 'in_progress')
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (urlFilters.view) localStorage.setItem('ticketsViewMode', urlFilters.view);
    if (urlFilters.scope) localStorage.setItem('ticketsScope', urlFilters.scope);
  }, [urlFilters.view, urlFilters.scope]);

  useEffect(() => {
    if (!urlFilters.view) {
      const saved = localStorage.getItem('ticketsViewMode') as ViewMode | null;
      if (saved && (saved === 'table' || saved === 'kanban' || saved === 'grid')) {
        setFilter('view', saved);
      }
    }
    if (!urlFilters.scope) {
      const saved = localStorage.getItem('ticketsScope') as TicketScope | null;
      if (saved && (saved === 'all' || saved === 'my_tickets' || saved === 'my_team')) {
        setFilter('scope', saved);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleViewChange = (mode: ViewMode) => setFilter('view', mode);
  const handleScopeChange = (scope: TicketScope) => setFilter('scope', scope);

  // Combined classification value from whichever axis is active
  const classificationValue: ClassificationValue = filterType
    ? `t:${filterType}`
    : filterCategory
      ? `c:${filterCategory}`
      : filterSource
        ? `s:${filterSource}`
        : '';

  const handleClassificationChange = (val: string) => {
    if (!val) {
      setMultiple({ type: '', category: '', source: '' });
    } else if (val.startsWith('t:')) {
      setMultiple({ type: val.slice(2), category: '', source: '' });
    } else if (val.startsWith('c:')) {
      setMultiple({ type: '', category: val.slice(2), source: '' });
    } else {
      setMultiple({ type: '', category: '', source: val.slice(2) });
    }
  };

  const dateRange = useMemo(() => {
    if (!filterDatePreset) return {};
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filterDatePreset === 'today') return { created_after: startOfDay };
    if (filterDatePreset === 'yesterday') {
      const yesterday = new Date(startOfDay);
      yesterday.setDate(yesterday.getDate() - 1);
      return { created_after: yesterday, created_before: startOfDay };
    }
    if (filterDatePreset === '7d') {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - 7);
      return { created_after: d };
    }
    if (filterDatePreset === '30d') {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - 30);
      return { created_after: d };
    }
    return {};
  }, [filterDatePreset]);

  const filters: TicketFilters = useMemo(() => {
    const f: TicketFilters = {
      search: searchTerm || undefined,
      status: statusFilter as any,
      ticket_type: (filterType || undefined) as any,
      ticket_category: (filterCategory || undefined) as any,
      source: (filterSource || undefined) as any,
      project_id: filterProject || undefined,
      assigned_to: ticketScope === 'my_tickets' && currentUser?.id ? currentUser.id : undefined,
      assigned_team_id: ticketScope === 'my_team' && teamIds.length > 0 ? teamIds : undefined,
    };
    if (dateRange.created_after) f.created_after = dateRange.created_after;
    if (dateRange.created_before) f.created_before = dateRange.created_before;
    return f;
  }, [searchTerm, statusFilter, filterType, filterCategory, filterSource, filterProject, ticketScope, teamIds, currentUser?.id, dateRange]);

  const hasActiveFilters = filterType || filterCategory || filterSource || filterDatePreset || filterProject;
  const classificationActive = !!(filterType || filterCategory || filterSource);

  const teamLabel = teamsLoading
    ? 'Team'
    : teams.length === 0
      ? 'Team'
      : teams.length === 1
        ? teams[0].name
        : `My Teams (${teams.length})`;

  const teamDisabled = !teamsLoading && teams.length === 0;

  return (
    <ModulePage config={nocConfig} hideHeader>
      <div className="flex flex-col h-full">
        {/* Row 1: Scope toggle + View toggle + Create */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 mb-3">
          <div className="flex items-center bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-1 overflow-x-auto">
            <button
              onClick={() => handleScopeChange('all')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap
                ${ticketScope === 'all' ? 'bg-[var(--ff-primary-500)] text-white shadow-sm' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'}`}
            >
              All<span className="hidden sm:inline"> Tickets</span>
            </button>
            <button
              onClick={() => handleScopeChange('my_tickets')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap
                ${ticketScope === 'my_tickets' ? 'bg-blue-500 text-white shadow-sm' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'}`}
            >
              <User className="w-3.5 h-3.5" />
              Mine
            </button>
            <button
              onClick={() => !teamDisabled && handleScopeChange('my_team')}
              disabled={teamDisabled}
              title={teamDisabled ? 'You are not a member of any team' : teamLabel}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap
                ${teamDisabled
                  ? 'opacity-40 cursor-not-allowed text-[var(--ff-text-tertiary)]'
                  : ticketScope === 'my_team'
                    ? 'bg-purple-500 text-white shadow-sm'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'
                }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{teamLabel}</span>
              <span className="sm:hidden">Team</span>
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-1">
              <button
                onClick={() => handleViewChange('table')}
                className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${viewMode === 'table' ? 'bg-[var(--ff-primary-500)] text-white shadow-sm' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'}`}
                title="Table View"
              >
                <TableIcon />
                <span className="hidden sm:inline">Table</span>
              </button>
              <button
                onClick={() => handleViewChange('kanban')}
                className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${viewMode === 'kanban' ? 'bg-[var(--ff-primary-500)] text-white shadow-sm' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'}`}
                title="Kanban View"
              >
                <KanbanIcon />
                <span className="hidden sm:inline">Kanban</span>
              </button>
              <button
                onClick={() => handleViewChange('grid')}
                className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-all
                  ${viewMode === 'grid' ? 'bg-[var(--ff-primary-500)] text-white shadow-sm' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]'}`}
                title="Grid View"
              >
                <GridIcon />
                <span className="hidden sm:inline">Grid</span>
              </button>
            </div>

            <Link
              href="/noc/tickets/new"
              className="px-3 sm:px-4 py-2 bg-[var(--ff-primary-500)] text-white rounded-lg hover:bg-[var(--ff-primary-600)] transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
            >
              <span className="hidden sm:inline">Create Ticket</span>
              <span className="sm:hidden">+ New</span>
            </Link>
          </div>
        </div>

        {/* Row 2: Search + Filters (3 dropdowns instead of 5) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              placeholder="Search tickets..."
              value={searchTerm}
              onChange={(e) => setFilter('search', e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 sm:py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-base sm:text-sm placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]/50"
            />
            {searchTerm && (
              <button
                onClick={() => setFilter('search', '')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">

            {/* Combined classification — Discipline / Category / Source in one grouped select */}
            <select
              value={classificationValue}
              onChange={(e) => handleClassificationChange(e.target.value)}
              className={`px-2.5 py-2 rounded-lg text-sm border transition-colors flex-shrink-0
                ${classificationActive
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                  : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                }`}
            >
              <option value="">All Types</option>

              <optgroup label="── Discipline (who resolves)">
                <option value="t:activations">Activations</option>
                <option value="t:civils">Civils</option>
                <option value="t:maintenance">Maintenance</option>
                <option value="t:optical">Optical</option>
                <option value="t:dev_ops">DevOps</option>
              </optgroup>

              <optgroup label="── Category (what kind)">
                <option value="c:maintenance">Maintenance ticket</option>
                <option value="c:snag">Snag</option>
                <option value="c:hse_incident">HSE</option>
                <option value="c:sales_lead">Sales Lead</option>
                <option value="c:pre_provision">Pre-Provision</option>
                <option value="c:fault_repair">Fault Repair</option>
                <option value="c:modification">Modification</option>
                <option value="c:ont_swap">ONT Swap</option>
                <option value="c:new_installation">New Installation</option>
                <option value="c:serial_mismatch">Serial Mismatch</option>
                <option value="c:olt_investigation">OLT Investigation</option>
              </optgroup>

              <optgroup label="── Origin (how created)">
                <option value="s:manual">Manual</option>
                <option value="s:ad_hoc">Ad Hoc</option>
                <option value="s:wa_maintenance">WhatsApp</option>
                <option value="s:qcontact">QContact</option>
                <option value="s:construction">Construction</option>
                <option value="s:snags">Snags</option>
                <option value="s:qa_review">QA Review</option>
                <option value="s:pp_data">PP Data</option>
                <option value="s:olt_mismatch">OLT Mismatch</option>
                <option value="s:weekly_report">Weekly Report</option>
              </optgroup>
            </select>

            {/* Project */}
            <select
              value={filterProject}
              onChange={(e) => setFilter('project', e.target.value)}
              className={`px-2.5 py-2 rounded-lg text-sm border transition-colors flex-shrink-0 max-w-[180px]
                ${filterProject
                  ? 'bg-orange-500/10 border-orange-500/30 text-orange-300'
                  : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                }`}
            >
              <option value="">Project</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code ? `${p.code} — ${p.name}` : p.name}
                </option>
              ))}
            </select>

            {/* Date */}
            <select
              value={filterDatePreset}
              onChange={(e) => setFilter('date', e.target.value)}
              className={`px-2.5 py-2 rounded-lg text-sm border transition-colors flex-shrink-0
                ${filterDatePreset
                  ? 'bg-green-500/10 border-green-500/30 text-green-300'
                  : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]'
                }`}
            >
              <option value="">Date</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            {hasActiveFilters && (
              <button
                onClick={() => setMultiple({ type: '', category: '', source: '', date: '', project: '' })}
                className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] rounded hover:bg-[var(--ff-bg-secondary)]"
                title="Clear all filters"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Summary Tiles */}
        <TicketSummaryTiles filters={filters} />

        {/* View Content */}
        <div className="flex-1">
          {viewMode === 'table' ? (
            <TicketList initialFilters={filters} />
          ) : viewMode === 'grid' ? (
            <TicketGridView initialFilters={filters} />
          ) : (
            <KanbanBoard filters={filters} />
          )}
        </div>
      </div>
    </ModulePage>
  );
}
