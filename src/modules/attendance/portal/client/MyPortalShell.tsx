/**
 * Full-bleed mobile shell for the /my portal.
 *
 * No AppLayout: this portal is installed on phones, so we run it as a PWA
 * with its own minimal chrome (header strip + main content + optional footer
 * nav). Dark text on a white background is deliberate — field use is mostly
 * outdoors in bright sunlight where dark themes wash out.
 */

import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Clock, Home, History, LogOut, RefreshCw, Receipt } from 'lucide-react';

import { logout } from './api';
import { useMyServiceWorker } from './useServiceWorker';

export interface MyPortalShellProps {
  title: string;
  staffName?: string | null;
  /** Optional avatar URL — typically `profile.profilePhotoUrl`. Renders
   *  the photo at the right of the header strip; falls back to initials
   *  when missing or when the URL fails to load. */
  staffPhotoUrl?: string | null;
  /** Hide the footer nav on the login / onboard screens. */
  showFooterNav?: boolean;
  /** Hide the header on the login / onboard screens. */
  showHeader?: boolean;
  children: React.ReactNode;
}

function staffInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').toUpperCase().slice(0, 2);
}

function StaffAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [showFallback, setShowFallback] = React.useState(!photoUrl);
  const initials = staffInitials(name);
  return (
    <div className="relative h-10 w-10 shrink-0 rounded-full bg-blue-500/20 overflow-hidden flex items-center justify-center">
      {photoUrl && !showFallback && (
        <img
          src={photoUrl}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setShowFallback(true)}
        />
      )}
      {(!photoUrl || showFallback) && (
        <span className="text-sm font-semibold text-blue-200">{initials || '?'}</span>
      )}
    </div>
  );
}

export function MyPortalShell({
  title,
  staffName,
  staffPhotoUrl,
  showFooterNav = true,
  showHeader = true,
  children,
}: MyPortalShellProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);
  const { updateAvailable, updateServiceWorker } = useMyServiceWorker();

  const handleLogout = React.useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    // Always attempt the server round-trip (invalidates the DB session row +
    // clears the httpOnly cookie). On any failure we still redirect — better
    // to drop the user at the login screen than trap them on an authed page
    // with a now-broken cookie. The server-side log is the authoritative
    // signal; there's no approved client logger in this codebase yet.
    try {
      await logout();
    } catch {
      // swallow — see comment above.
    }
    // Defence in depth: tell the SW to drop the cached /api/my/session
    // response. The httpOnly cookie is gone, but if the user is offline
    // the SW could otherwise serve a stale "logged in" payload from
    // OFFLINE_CACHE. Best-effort — the navigator might not be available.
    try {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_SESSION_CACHE' });
      }
    } catch {
      // No SW yet, or postMessage rejected — fall through to the reload.
    }
    // Hard reload so the page remounts and the fresh (now-null) session
    // state takes effect. router.push('/my') is a no-op when the user
    // signs out from /my (the hub) — Next.js doesn't remount the page,
    // so the user appears stuck on the hub until they refresh manually.
    window.location.assign('/my');
  }, [loggingOut]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <Head>
        <title>{title} · Velocity Fibre</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="manifest" href="/manifest-my.json" />
      </Head>

      {showHeader && (
        <header className="bg-neutral-900 text-neutral-100 border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push('/my')}
            aria-label="Go to hub"
            className="flex items-center gap-3 min-w-0 text-left rounded-lg hover:bg-neutral-800/60 active:bg-neutral-800 -m-1 p-1"
          >
            <img
              src="/assets/vf/vf-logo.svg"
              alt=""
              aria-hidden="true"
              className="w-9 h-9 shrink-0 rounded-lg bg-white p-1"
            />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-neutral-400">Velocity Fibre</div>
              <div className="text-base font-semibold truncate">{title}</div>
            </div>
          </button>
          {staffName && (
            <div className="flex items-center gap-2">
              <StaffAvatar name={staffName} photoUrl={staffPhotoUrl} />
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium leading-tight">{staffName}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                aria-label={loggingOut ? 'Signing out' : 'Sign out'}
                className="inline-flex items-center justify-center gap-1 min-w-[48px] min-h-[48px] px-3 rounded-lg text-xs font-medium text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {loggingOut ? 'Signing out…' : 'Sign out'}
                </span>
              </button>
            </div>
          )}
        </header>
      )}

      {updateAvailable && (
        <div className="bg-blue-600 text-white px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span>A new version is ready.</span>
          <button
            type="button"
            onClick={updateServiceWorker}
            className="inline-flex items-center gap-1 font-medium underline"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reload
          </button>
        </div>
      )}

      <main className="w-full max-w-lg mx-auto px-4 py-4 pb-24">
        {children}
      </main>

      {showFooterNav && (
        <nav className="fixed bottom-0 inset-x-0 bg-neutral-900 border-t border-neutral-800 px-2 py-2 safe-area-pb">
          <div className="max-w-lg mx-auto grid grid-cols-4 gap-2">
            <FooterLink href="/my" label="Home" icon={<Home className="w-5 h-5" />} />
            <FooterLink href="/my/attendance" label="Clock" icon={<Clock className="w-5 h-5" />} />
            <FooterLink href="/my/receipts" label="Receipts" icon={<Receipt className="w-5 h-5" />} />
            <FooterLink
              href="/my/attendance/history"
              label="History"
              icon={<History className="w-5 h-5" />}
            />
          </div>
        </nav>
      )}
    </div>
  );
}

function FooterLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  const router = useRouter();
  const active = router.pathname === href;
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className={`flex flex-col items-center justify-center py-2 rounded-lg text-xs font-medium transition-colors ${
        active ? 'bg-blue-600/20 text-blue-300' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
      }`}
    >
      {icon}
      <span className="mt-0.5">{label}</span>
    </button>
  );
}
