'use client';

/**
 * Risk Acceptance Review Page Client Component
 *
 * Manages QA risk acceptances and conditional approvals:
 * - Active risk acceptances
 * - Expiring risks (approaching resolution deadlines)
 * - Resolved risks
 * - Risk resolution tracking
 * - Follow-up scheduling
 *
 * 🟢 WORKING: Risk acceptance review page with filtering and management
 */

import { useState } from 'react';

type RiskFilter = 'active' | 'expiring' | 'resolved';

export default function RiskAcceptanceReviewPageClient() {
  const [filter, setFilter] = useState<RiskFilter>('active');

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Risk Acceptance Review</h1>
        <p className="text-[var(--ff-text-secondary)]">
          Track and manage conditional QA approvals and risk acceptances
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="mb-6 flex gap-2 border-b border-[var(--ff-border-light)]">
        <button
          onClick={() => setFilter('active')}
          className={`px-4 py-2 font-medium transition-colors ${
            filter === 'active'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          Active Risks
        </button>
        <button
          onClick={() => setFilter('expiring')}
          className={`px-4 py-2 font-medium transition-colors ${
            filter === 'expiring'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          Expiring Soon
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`px-4 py-2 font-medium transition-colors ${
            filter === 'resolved'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]'
          }`}
        >
          Resolved
        </button>
      </div>

      {/* Risk Acceptance List */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md border border-[var(--ff-border-light)]">
        {filter === 'active' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Active Risk Acceptances</h2>
            <p className="text-[var(--ff-text-tertiary)]">
              Displays all active conditional approvals requiring follow-up
            </p>
            {/* 🔵 MOCK: Active risk acceptances list will be implemented with API integration */}
          </div>
        )}

        {filter === 'expiring' && (
          <div className="p-6">
            <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg
                    className="h-5 w-5 text-yellow-400"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-yellow-300">
                    Risks Requiring Immediate Attention
                  </h3>
                  <p className="mt-1 text-sm text-yellow-400/80">
                    These risk acceptances are approaching their expiry dates and require resolution
                  </p>
                </div>
              </div>
            </div>
            <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Expiring Risks</h2>
            <p className="text-[var(--ff-text-tertiary)]">
              Risk acceptances with upcoming expiry dates (within 7 days)
            </p>
            {/* 🔵 MOCK: Expiring risk acceptances list will be implemented with API integration */}
          </div>
        )}

        {filter === 'resolved' && (
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Resolved Risk Acceptances</h2>
            <p className="text-[var(--ff-text-tertiary)]">
              Historical record of resolved conditional approvals
            </p>
            {/* 🔵 MOCK: Resolved risk acceptances list will be implemented with API integration */}
          </div>
        )}
      </div>
    </div>
  );
}
