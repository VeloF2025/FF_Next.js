/**
 * /my/stores — stores PWA landing page.
 *
 * Access-gated to role='stores' or role='admin'. All other roles see a
 * "Not authorised" screen with a back link.
 *
 * Three tiles:
 *  1. Issue stock    → /my/stores/issue  (active)
 *  2. Return stock   → disabled / Phase 3
 *  3. Today's summary → disabled / Phase 4
 *
 * Session is fetched client-side via getSession() (same pattern as
 * pages/my/index.tsx). SSR renders a loading shell so the page is
 * cacheable in the SW without leaking auth state into cached HTML.
 *
 * ⚪ UNTESTED: integration tests in Task 2.9
 */

import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  LayoutDashboard,
  Loader2,
  AlertCircle,
  ChevronLeft,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { getSession } from '@/modules/attendance/portal/client/api';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { useStockSync } from '@/modules/field-stock-pwa/offline/useStockSync';
import type { StaffRole } from '@/modules/attendance/portal/types';

// =============================================================================
// Role gate helper
// =============================================================================

/** Roles that may access /my/stores */
const STORES_ROLES: ReadonlyArray<StaffRole> = ['stores', 'admin'];

function isAuthorised(role: StaffRole | null): boolean {
  return role !== null && (STORES_ROLES as ReadonlyArray<string>).includes(role);
}

// =============================================================================
// Session state
// =============================================================================

type SessionState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'authed'; profile: AttendanceProfile }
  | { kind: 'error'; message: string };

// =============================================================================
// Page
// =============================================================================

const StoresIndexPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const [session, setSession] = React.useState<SessionState>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    getSession()
      .then((res) => {
        if (cancelled) return;
        if (res.session && res.profile) {
          setSession({ kind: 'authed', profile: res.profile });
        } else {
          setSession({ kind: 'guest' });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSession({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Session check failed',
          });
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (session.kind === 'loading') {
    return (
      <MyPortalShell title="Stores" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </MyPortalShell>
    );
  }

  if (session.kind === 'guest') {
    if (typeof window !== 'undefined') {
      void router.replace('/my');
    }
    return (
      <MyPortalShell title="Stores" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">
          Redirecting…
        </div>
      </MyPortalShell>
    );
  }

  if (session.kind === 'error') {
    return (
      <MyPortalShell title="Stores" showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{session.message}</span>
        </div>
      </MyPortalShell>
    );
  }

  const { profile } = session;

  if (!isAuthorised(profile.role)) {
    return (
      <MyPortalShell title="Stores" staffName={profile.name} showFooterNav={false}>
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-neutral-200">Not authorised</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            The stores section is only available to stores staff and administrators.
          </p>
          <button
            type="button"
            onClick={() => void router.push('/my')}
            className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to hub
          </button>
        </div>
      </MyPortalShell>
    );
  }

  return (
    <AuthorisedStoresHub
      profile={profile}
      onIssue={() => void router.push('/my/stores/issue')}
    />
  );
};

StoresIndexPage.getLayout = (page: React.ReactElement) => page;

export default StoresIndexPage;

// =============================================================================
// Authorised hub — extracted to keep the page component under 300 lines
// =============================================================================

interface AuthorisedStoresHubProps {
  profile: AttendanceProfile;
  onIssue: () => void;
}

function AuthorisedStoresHub({ profile, onIssue }: AuthorisedStoresHubProps) {
  const { pendingCount, syncing } = useStockSync();
  const isPending = profile.accountStatus === 'pending';

  return (
    <MyPortalShell
      title="Stores"
      staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl}
      showFooterNav={false}
    >
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
      {pendingCount > 0 && (
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
      )}

      {pendingCount === 0 && !syncing && (
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

        {/* Return stock — Phase 3 */}
        <StoreTile
          icon={<ArrowUpFromLine className="w-5 h-5" />}
          iconClass="bg-neutral-800 text-neutral-500"
          title="Return stock"
          subtitle="Coming in Phase 3"
          disabled
        />

        {/* Today's summary — Phase 4, full width */}
        <div className="col-span-2">
          <StoreTile
            icon={<LayoutDashboard className="w-5 h-5" />}
            iconClass="bg-neutral-800 text-neutral-500"
            title="Today's summary"
            subtitle="Coming in Phase 4"
            disabled
            fullWidth
          />
        </div>
      </div>
    </MyPortalShell>
  );
}

// =============================================================================
// StoreTile
// =============================================================================

interface StoreTileProps {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
}

function StoreTile({
  icon,
  iconClass,
  title,
  subtitle,
  onClick,
  disabled = false,
  fullWidth = false,
}: StoreTileProps) {
  const baseClass = [
    'rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-left',
    'transition-colors min-h-[110px] flex flex-col gap-2',
    fullWidth ? 'w-full' : '',
    disabled
      ? 'opacity-50 pointer-events-none cursor-not-allowed'
      : 'hover:bg-neutral-800/80 active:bg-neutral-800 cursor-pointer',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={baseClass}
    >
      <span
        className={`flex w-10 h-10 items-center justify-center rounded-xl ${iconClass}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold text-neutral-100">{title}</div>
        <div className="text-xs text-neutral-400 mt-0.5">{subtitle}</div>
      </div>
    </button>
  );
}
