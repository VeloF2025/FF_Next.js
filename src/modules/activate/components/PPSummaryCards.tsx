'use client';

import React from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateFormat';
import { type PPCardCategory, type PPStats, type LookupStatus } from './ppDataShared';

export function SummaryCards({ stats, activeCard, onCardClick }: { stats: PPStats; activeCard: PPCardCategory | null; onCardClick: (cat: PPCardCategory) => void }) {
  const cards: { cat: PPCardCategory; value: number; label: string; color: string; hover: string; activeBorder: string }[] = [
    { cat: 'total', value: stats.total, label: 'Total Imported', color: 'text-[var(--ff-text-primary)]', hover: 'hover:border-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-secondary)]', activeBorder: 'border-[var(--ff-text-tertiary)] bg-[var(--ff-bg-secondary)]' },
    { cat: 'activated', value: stats.activated, label: 'Activated', color: 'text-green-500', hover: 'hover:border-green-700 hover:bg-green-900/10', activeBorder: 'border-green-500 bg-green-900/20' },
    { cat: 'located', value: stats.located, label: 'Located', color: 'text-blue-500', hover: 'hover:border-blue-700 hover:bg-blue-900/10', activeBorder: 'border-blue-500 bg-blue-900/20' },
    { cat: 'not_found', value: stats.notFound, label: 'Not Found', color: 'text-amber-500', hover: 'hover:border-amber-700 hover:bg-amber-900/10', activeBorder: 'border-amber-500 bg-amber-900/20' },
    { cat: 'ticketed', value: stats.ticketed, label: 'Ticketed', color: 'text-orange-500', hover: 'hover:border-orange-700 hover:bg-orange-900/10', activeBorder: 'border-orange-500 bg-orange-900/20' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
      {cards.map(c => {
        const isActive = activeCard === c.cat;
        return (
          <button key={c.cat} onClick={() => onCardClick(c.cat)}
            className={`rounded-lg p-4 border-2 text-left transition-colors cursor-pointer ${
              isActive ? c.activeBorder : `bg-[var(--ff-bg-primary)] border-[var(--ff-border-light)] ${c.hover}`
            }`}>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">{c.label}</p>
          </button>
        );
      })}
      <div className="bg-[var(--ff-bg-primary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
        <p className="text-sm text-[var(--ff-text-secondary)]">Last Import</p>
        <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
          {stats.lastImport ? formatDisplayDate(stats.lastImport.date) : 'Never'}
        </p>
      </div>
    </div>
  );
}

export function LookupProgressBanner({ status }: { status: LookupStatus }) {
  return (
    <div className="bg-purple-900/20 border border-purple-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
        <span className="text-sm font-medium text-purple-300">1Map Serial Search in Progress</span>
        <span className="text-xs text-purple-400 ml-auto">{status.elapsed_seconds ? `${status.elapsed_seconds}s elapsed` : ''}</span>
      </div>
      <div className="w-full bg-purple-900/40 rounded-full h-2">
        <div className="bg-purple-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${Math.round((status.searched / status.total) * 100)}%` }} />
      </div>
      <div className="flex gap-6 text-xs text-purple-300">
        <span>Searched: <strong>{status.searched}</strong> / {status.total}</span>
        <span className="text-teal-400">Found: <strong>{status.resolved}</strong></span>
        <span className="text-amber-400">Not Found: <strong>{status.not_found}</strong></span>
        {status.errors > 0 && <span className="text-red-400">Errors: <strong>{status.errors}</strong></span>}
      </div>
    </div>
  );
}

export function LookupCompleteBanner({ status, onDismiss }: { status: LookupStatus; onDismiss: () => void }) {
  return (
    <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 flex items-center gap-3">
      <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
      <div className="text-sm text-green-300">
        <strong>1Map search complete.</strong>{' '}
        Searched {status.total} serials — found <strong>{status.resolved}</strong>,
        not found {status.not_found}
        {status.elapsed_seconds ? ` in ${status.elapsed_seconds}s` : ''}.
      </div>
      <button onClick={onDismiss} className="ml-auto text-green-500 hover:text-green-300">
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}
