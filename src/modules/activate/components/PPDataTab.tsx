/**
 * PPDataTab — PP Data main tab. Render-only shell; all state lives in usePPData.
 * Visual style matches OLT Investigate tab: outer card wraps stats + filters + table.
 * Banners (LookupProgressBanner, LookupCompleteBanner) live OUTSIDE the card so they
 * show even when stats.total === 0.
 */

'use client';

import { AlertCircle, XCircle } from 'lucide-react';
import { LookupProgressBanner, LookupCompleteBanner } from './PPSummaryCards';
import { PPStatsBar } from './PPStatsBar';
import { PPDataFilters } from './PPDataFilters';
import { PPRecordTable } from './PPRecordTable';
import { CreatePPTicketsModal } from './CreatePPTicketsModal';
import { usePPData } from './usePPData';

const PAGE_SIZE = 50;

export function PPDataTab() {
  const { state, actions } = usePPData();
  const {
    isResolving, error, stats, records, page, total,
    filterProject, filterStatus, dateFilter, customDateFrom, customDateTo,
    filterPriority, filterAging, filterPon, isImportingOlt,
    searchText, lookupStatus, selectedIds, showTicketModal,
    creatingTickets, activeCard, selectingAllUnticketed, projects,
  } = state;
  const {
    setPage, fetchStats, fetchRecords,
    handleResolveAll, handleCreateTickets, handleSelectAllUnticketed,
    handleExport, handleImportOlt, handleCardClick, handleFilterChange,
    setFilterProject, setFilterStatus,
    setDateFilter, setCustomDateFrom, setCustomDateTo,
    setFilterPriority, setFilterAging, setFilterPon,
    setSearchText, setSelectedIds, setShowTicketModal, setLookupStatus,
    toggleSelect, toggleSelectAll, allSelectableChecked, selectableOnPage,
  } = actions;

  return (
    <div className="space-y-6">
      {/* Info banner — always above the container */}
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-300">
          PP Data is automatically imported from the <strong>PP DATA</strong> sheet when you import an OES Excel file
          via the OES tab. Use the actions below to locate imported serials against local data or 1Map. Serials are
          marked <strong>Activated</strong> when they appear in OES activations.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-300">Error</p>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Lookup banners — outside the main card so they show when stats.total === 0 */}
      {lookupStatus?.status === 'running' && lookupStatus.total > 0 && (
        <LookupProgressBanner status={lookupStatus} />
      )}
      {lookupStatus?.status === 'success' && lookupStatus.total > 0 && (
        <LookupCompleteBanner status={lookupStatus} onDismiss={() => setLookupStatus(null)} />
      )}

      {/* Empty state — no data imported yet */}
      {stats?.total === 0 && (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          <p className="text-lg mb-2">No PP Data imported yet</p>
          <p className="text-sm">Import an OES Excel file from the OES tab to automatically extract PP Data.</p>
        </div>
      )}

      {/* Main container card — mirrors OltInvestigateTab structure */}
      {stats && stats.total > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          {/* Stat cards row */}
          <PPStatsBar
            stats={stats}
            activeCard={activeCard}
            onCardClick={handleCardClick}
          />

          {/* Filter bar + action buttons */}
          <PPDataFilters
            projects={projects}
            searchText={searchText}
            onSearchChange={v => { setSearchText(v); }}
            filterProject={filterProject}
            onProjectChange={handleFilterChange(setFilterProject)}
            filterStatus={filterStatus}
            onStatusChange={handleFilterChange(setFilterStatus)}
            filterPriority={filterPriority}
            onPriorityChange={handleFilterChange(setFilterPriority)}
            filterAging={filterAging}
            onAgingChange={handleFilterChange(setFilterAging)}
            dateFilter={dateFilter}
            onDateFilterChange={(f) => { setDateFilter(f); setPage(1); }}
            customDateFrom={customDateFrom}
            onCustomDateFromChange={(d) => { setCustomDateFrom(d); setPage(1); }}
            customDateTo={customDateTo}
            onCustomDateToChange={(d) => { setCustomDateTo(d); setPage(1); }}
            filterPon={filterPon}
            onPonChange={handleFilterChange(setFilterPon)}
            total={total}
            selectedCount={selectedIds.length}
            onExport={handleExport}
            onImportOlt={handleImportOlt}
            isImportingOlt={isImportingOlt}
            onResolveAll={handleResolveAll}
            isResolving={isResolving}
            isLookupRunning={lookupStatus?.status === 'running'}
            unticketedCount={stats.unticketed}
            onSelectAllUnticketed={handleSelectAllUnticketed}
            isSelectingAllUnticketed={selectingAllUnticketed}
            onCreateTickets={() => setShowTicketModal(true)}
            onClearSelection={() => setSelectedIds([])}
            onRefresh={() => { void fetchStats(); void fetchRecords(); }}
          />

          {/* Table */}
          <PPRecordTable
            records={records}
            isLoading={false}
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            allSelectableChecked={allSelectableChecked}
            selectableOnPage={selectableOnPage}
          />
        </div>
      )}

      {/* Ticket creation modal */}
      {showTicketModal && (
        <CreatePPTicketsModal
          selectedRecords={records.filter(r => selectedIds.includes(r.id))}
          onConfirm={handleCreateTickets}
          onClose={() => setShowTicketModal(false)}
          loading={creatingTickets}
        />
      )}
    </div>
  );
}
