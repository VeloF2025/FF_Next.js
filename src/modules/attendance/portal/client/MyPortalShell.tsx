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
import { Clock, History, LogOut } from 'lucide-react';

import { logout } from './api';

export interface MyPortalShellProps {
  title: string;
  staffName?: string | null;
  /** Hide the footer nav on the login / onboard screens. */
  showFooterNav?: boolean;
  /** Hide the header on the login / onboard screens. */
  showHeader?: boolean;
  children: React.ReactNode;
}

export function MyPortalShell({
  title,
  staffName,
  showFooterNav = true,
  showHeader = true,
  children,
}: MyPortalShellProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);

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
    // Non-httpOnly client state (device fingerprint survives a logout, which
    // is correct — it's a device identity, not a session secret).
    await router.push('/my');
  }, [loggingOut, router]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <Head>
        <title>{title} · FibreFlow</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#1e40af" />
        <link rel="manifest" href="/manifest-my.json" />
      </Head>

      {showHeader && (
        <header className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between shadow">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">FibreFlow</div>
            <div className="text-base font-semibold">{title}</div>
          </div>
          {staffName && (
            <div className="text-right">
              <div className="text-sm font-medium leading-tight">{staffName}</div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="mt-0.5 inline-flex items-center gap-1 text-xs opacity-90 hover:opacity-100 underline disabled:opacity-50"
              >
                <LogOut className="w-3 h-3" />
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </header>
      )}

      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-4 pb-24">
        {children}
      </main>

      {showFooterNav && (
        <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-2 py-2 safe-area-pb">
          <div className="max-w-lg mx-auto grid grid-cols-2 gap-2">
            <FooterLink href="/my/attendance" label="Clock" icon={<Clock className="w-5 h-5" />} />
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
        active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      {icon}
      <span className="mt-0.5">{label}</span>
    </button>
  );
}
