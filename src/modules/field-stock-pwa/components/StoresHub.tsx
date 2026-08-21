/**
 * StoresHub — authorised stores landing tile grid.
 *
 * Rendered by pages/my/stores/index.tsx once session is confirmed as
 * role='stores' or role='admin'. Extracted to keep the page file under
 * 300 lines.
 *
 * Tiles:
 *  1. Issue stock    — active, navigates to /my/stores/issue
 *  2. Return stock   — disabled, Phase 3
 *  3. Today summary  — disabled, Phase 4
 *
 * Offline sync badge reads from useStockSync().
 * ⚪ UNTESTED: integration tests in Task 2.9
 */

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';

import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { useStockSync } from '@/modules/field-stock-pwa/offline/useStockSync';
import { useStoresTodayUnaccounted } from '@/modules/field-stock-pwa/hooks/useStoresTodayUnaccounted';
import { isReturnCreator, isReturnInspector } from '../lib/storesRoles';
import { AbandonedIssuesBanner } from './AbandonedIssuesBanner';
import { AbandonedReturnsBanner } from './AbandonedReturnsBanner';
import { StoreTile } from './StoreTile';

// =============================================================================
// Props
// =============================================================================

export interface StoresHubProps {
  profile: AttendanceProfile;
  onIssue: () => void;
  onReturn: () => void;
  onInspect: () => void;
  onToday: () => void;
  /** Opens the historical paper-sheet backfill tool. */
  onPaperSheet: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function StoresHub({ profile, onIssue, onReturn, onInspect, onToday, onPaperSheet }: StoresHubProps) {
  const { pendingCount, abandonedIssuesCount, abandonedReturnsCount, syncing, dismissAbandoned } = useStockSync();
  const isPending = profile.accountStatus === 'pending';
  const todayUnaccounted = useStoresTodayUnaccounted();

  return (
    <MyPortalShell
      title="Stores"
      staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl}
      showFooterNav={false}
    >
      {/* Abandoned-issues banner — permanently-failed queued pickings */}
      {abandonedIssuesCount > 0 && (
        <AbandonedIssuesBanner
          count={abandonedIssuesCount}
          onView={() => {
            // Inline panel — no navigation needed yet.
          }}
          onDismiss={dismissAbandoned}
        />
      )}

      {/* Abandoned-returns banner — permanently-failed queued returns */}
      {abandonedReturnsCount > 0 && (
        <AbandonedReturnsBanner
          count={abandonedReturnsCount}
          onDismiss={dismissAbandoned}
        />
      )}

      {/* Pending account banner */}
      {isPending && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg bg-amber-950/50 border border-amber-800 px-3 py-3 text-sm text-amber-200"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Your stores account is pending admin approval. You can still issue, but only
            up to R5,000 per tech.
          </span>
        </div>
      )}

      {/* Offline sync badge */}
      {pendingCount > 0 ? (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-xs">
          {syncing ? (
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span className="text-neutral-300">
            {pendingCount} queued {syncing ? '— syncing…' : '— will sync when online'}
          </span>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-xs">
          <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-neutral-400">All synced</span>
        </div>
      )}

      {/* Tile grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Issue stock — active */}
        <StoreTile
          icon={<ArrowDownToLine className="w-5 h-5" />}
          iconClass="bg-emerald-500/15 text-emerald-300"
          title="Issue stock"
          subtitle="Issue serials to a tech"
          onClick={onIssue}
        />

        {/* Return stock — active (Phase 3) */}
        {isReturnCreator(profile.role, profile.authRole) && (
          <StoreTile
            icon={<ArrowUpFromLine className="w-5 h-5" />}
            iconClass="bg-blue-500/15 text-blue-300"
            title="Return stock"
            subtitle="Return serials from the field"
            onClick={onReturn}
          />
        )}

        {/* Inspect returns — stores/admin only (Phase 3) */}
        {isReturnInspector(profile.role, profile.authRole) && (
          <StoreTile
            icon={<ClipboardCheck className="w-5 h-5" />}
            iconClass="bg-amber-500/15 text-amber-300"
            title="Inspect returns"
            subtitle="Disposition and restock"
            onClick={onInspect}
          />
        )}

        {/* Old paper sheets — a BACKFILL tool, not a handout. Amber and set
            apart from the issue tile on purpose: recording a live handout as a
            historical sheet would back-date real stock movement. */}
        {isReturnInspector(profile.role, profile.authRole) && (
          <div className="col-span-2">
            <StoreTile
              icon={<FileText className="w-5 h-5" />}
              iconClass="bg-amber-500/15 text-amber-300"
              title="Record an old paper sheet"
              subtitle="Scan serials off a sheet already filled in"
              onClick={onPaperSheet}
              fullWidth
            />
          </div>
        )}

        {/* Today's summary — Phase 4, full width */}
        <div className="col-span-2">
          <StoreTile
            icon={<LayoutDashboard className="w-5 h-5" />}
            iconClass="bg-indigo-500/15 text-indigo-300"
            title="Today's summary"
            subtitle={
              todayUnaccounted === null
                ? 'Reconciliation for today'
                : todayUnaccounted > 0
                  ? `${todayUnaccounted} unaccounted`
                  : 'All accounted for'
            }
            onClick={onToday}
            badge={todayUnaccounted && todayUnaccounted > 0 ? todayUnaccounted : undefined}
            fullWidth
          />
        </div>
      </div>
    </MyPortalShell>
  );
}

