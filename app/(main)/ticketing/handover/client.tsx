'use client';

/**
 * Handover Center Page Client Component
 *
 * Manages ticket handover process between teams:
 * - Tickets pending handover (Build → QA, QA → Maintenance)
 * - Handover wizard for creating immutable snapshots
 * - Handover history and audit trail
 * - Ownership tracking
 * - Validation gate checks
 *
 * 🟢 WORKING: Handover center page integrates handover components
 */

import { HandoverWizard } from '@/modules/ticketing/components/Handover/HandoverWizard';
import { HandoverHistory } from '@/modules/ticketing/components/Handover/HandoverHistory';
import { useState } from 'react';

export default function HandoverCenterPageClient() {
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Handover Center</h1>
        <p className="text-[var(--ff-text-secondary)]">Manage ticket handovers between Build, QA, and Maintenance teams</p>
      </div>

      {/* View Toggle */}
      <div className="mb-6 flex gap-4">
        <button
          onClick={() => setShowHistory(false)}
          className={`px-4 py-2 rounded-lg transition-colors ${
            !showHistory
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
          }`}
        >
          Create Handover
        </button>
        <button
          onClick={() => setShowHistory(true)}
          className={`px-4 py-2 rounded-lg transition-colors ${
            showHistory
              ? 'bg-blue-600 text-white'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
          }`}
        >
          View History
        </button>
      </div>

      {/* Content Area */}
      {showHistory ? (
        <HandoverHistory />
      ) : (
        <div>
          {/* Pending Handovers List */}
          <div className="mb-6 bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
            <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Tickets Pending Handover</h2>
            <p className="text-[var(--ff-text-tertiary)]">
              Select a ticket to create a handover snapshot
            </p>
            {/* 🔵 MOCK: Pending tickets list will be implemented with API integration */}
          </div>

          {/* Handover Wizard */}
          {selectedTicketId && (
            <HandoverWizard
              ticketId={selectedTicketId}
              onComplete={() => setSelectedTicketId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
