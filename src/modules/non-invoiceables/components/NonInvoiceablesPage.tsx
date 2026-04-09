'use client';

/**
 * NonInvoiceablesPage — Main page component for the Non-Invoiceable Action Centre.
 * Shows Overview dashboard with category cards, then a unified items table
 * filtered by category when a card is clicked.
 */

import { useState, useCallback } from 'react';
import { ArrowLeft, LayoutDashboard, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OverviewDashboard } from './OverviewDashboard';
import { ItemsTable } from './ItemsTable';
import { CreateTicketModal } from './CreateTicketModal';
import { BillingCrossRefTab } from './BillingCrossRefTab';
import type { NonInvoiceableCategory, NonInvoiceableItem, IssueSource } from '../types';
import { CATEGORY_LABELS } from '../types';

type ViewMode = 'action_centre' | 'billing';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TicketSelection {
  id: string;
  dr_number: string;
  category: NonInvoiceableCategory;
  source: IssueSource;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function NonInvoiceablesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('action_centre');
  const [activeCategory, setActiveCategory] = useState<NonInvoiceableCategory | null>(null);
  const [project, setProject] = useState<string | undefined>(undefined);
  const [ticketItems, setTicketItems] = useState<TicketSelection[]>([]);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCategoryClick = useCallback((category: NonInvoiceableCategory) => {
    setActiveCategory(category);
  }, []);

  const handleBack = useCallback(() => {
    setActiveCategory(null);
  }, []);

  const handleCreateTickets = useCallback((items: NonInvoiceableItem[]) => {
    setTicketItems(items.map(i => ({
      id: i.id,
      dr_number: i.dr_number,
      category: i.category,
      source: i.source,
    })));
    setShowTicketModal(true);
  }, []);

  const handleTicketSuccess = useCallback(() => {
    setShowTicketModal(false);
    setTicketItems([]);
    setRefreshKey(k => k + 1);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header + view mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {activeCategory && viewMode === 'action_centre' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}
          <div>
            <h2 className="text-xl font-semibold text-white">
              {viewMode === 'billing'
                ? 'Weekly Billing Scorecard'
                : activeCategory
                  ? `Non-Invoiceables — ${CATEGORY_LABELS[activeCategory]}`
                  : 'Non-Invoiceable Action Centre'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {viewMode === 'billing'
                ? 'Cross-reference FT deductions against actioned tickets'
                : activeCategory
                  ? `Viewing all ${CATEGORY_LABELS[activeCategory].toLowerCase()} issues`
                  : 'Daily OES detection + weekly billing reconciliation'}
            </p>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex bg-[#0d1117] border border-gray-700 rounded-lg p-0.5">
          <button
            onClick={() => { setViewMode('action_centre'); setActiveCategory(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
              viewMode === 'action_centre'
                ? 'bg-[#161b22] text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            Action Centre
          </button>
          <button
            onClick={() => { setViewMode('billing'); setActiveCategory(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
              viewMode === 'billing'
                ? 'bg-[#161b22] text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            Weekly Billing
          </button>
        </div>
      </div>

      {/* Project filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-400">Project:</label>
        <select
          value={project ?? ''}
          onChange={e => setProject(e.target.value || undefined)}
          className="bg-[#0d1117] border border-gray-600 rounded px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Projects</option>
          <option value="Lawley">Lawley</option>
          <option value="Mohadin">Mohadin</option>
          <option value="Mamelodi">Mamelodi</option>
        </select>
      </div>

      {/* Content */}
      {viewMode === 'billing' ? (
        <BillingCrossRefTab key={`billing-${refreshKey}`} project={project} />
      ) : !activeCategory ? (
        <OverviewDashboard
          key={`overview-${refreshKey}`}
          project={project}
          onCategoryClick={handleCategoryClick}
        />
      ) : (
        <ItemsTable
          key={`items-${activeCategory}-${refreshKey}`}
          category={activeCategory}
          project={project}
          onCreateTickets={handleCreateTickets}
        />
      )}

      {/* Shared ticket modal */}
      {showTicketModal && (
        <CreateTicketModal
          isOpen={showTicketModal}
          onClose={() => { setShowTicketModal(false); setTicketItems([]); }}
          selectedItems={ticketItems}
          onSuccess={handleTicketSuccess}
        />
      )}
    </div>
  );
}
