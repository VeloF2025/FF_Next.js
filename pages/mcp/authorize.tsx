/**
 * OAuth consent screen for the Claude remote MCP connector.
 *
 * claude.ai sends the user here (via the MCP service's /authorize) with a
 * ?state_id= identifying the pending OAuth request. Clicking Allow POSTs to
 * /api/mcp/consent, which mints a read-only token for the SIGNED-IN user and hands
 * it to the MCP service; we then follow the service's redirectUrl back to Claude.
 *
 * Rendered standalone rather than inside AppLayout: this is a consent screen reached
 * from an external site, so app chrome (sidebar, nav) is noise and invites the user to
 * wander off mid-authorization. Deliberately NOT wrapped in ProtectedRoute either —
 * its fallbackPath is '/login', which is not a route in this app, and it would drop the
 * state_id. Unauthenticated visitors are sent to /sign-in with a returnUrl carrying the
 * full path + query, so the state_id survives the login round-trip.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { McpConsentCard } from '@/components/mcp/McpConsentCard';

type Phase = 'checking' | 'ready' | 'submitting' | 'redirecting' | 'cancelled' | 'error';

interface ConsentResponse {
  data?: { redirectUrl?: string };
  error?: { message?: string };
}

export default function McpAuthorizePage() {
  const router = useRouter();
  const { currentUser, isAuthenticated, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const rawStateId = router.query.state_id;
  const stateId = typeof rawStateId === 'string' ? rawStateId : '';

  useEffect(() => {
    // router.query is empty on the first render until the router has hydrated; acting
    // before then would report a missing state_id that is actually present.
    if (!router.isReady || loading) return;

    if (!isAuthenticated) {
      // asPath carries the query string, so state_id round-trips through login.
      void router.replace(`/sign-in?returnUrl=${encodeURIComponent(router.asPath)}`);
      return;
    }

    if (!stateId) {
      setError(
        'This link is missing its authorization reference. Return to Claude and start the connection again.'
      );
      setPhase('error');
      return;
    }

    // Don't stomp on a submission already in flight: this effect re-runs whenever the
    // router or auth state ticks, and resetting to 'ready' would re-enable the button
    // mid-request.
    setPhase((current) => (current === 'checking' ? 'ready' : current));
  }, [router, router.isReady, loading, isAuthenticated, stateId]);

  const allow = useCallback(async () => {
    // A ref, not the phase state: React batches state updates inside an event handler,
    // so a setPhase updater does not run before the next line and cannot gate anything.
    // A double "Enter" or fast double-click fires both handlers before React re-renders
    // the button into its disabled state, and each extra POST mints a token that no
    // grant will ever point at. The ref is written synchronously, so it does gate.
    //
    // Never released: every outcome is terminal. Success navigates to claude.ai;
    // failure renders a card with no Allow button and tells the user to restart from
    // Claude, because a state_id the service already consumed cannot be retried here.
    if (inFlight.current) return;
    inFlight.current = true;

    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch('/api/mcp/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId }),
      });
      const json = (await res.json().catch(() => null)) as ConsentResponse | null;
      const redirectUrl = json?.data?.redirectUrl;

      if (!res.ok || !redirectUrl) {
        setError(
          json?.error?.message ??
            'Authorization could not be completed. Return to Claude and try connecting again.'
        );
        setPhase('error');
        return;
      }

      setPhase('redirecting');
      // Full navigation, not router.push: redirectUrl points at claude.ai, which is
      // outside this Next.js app.
      window.location.assign(redirectUrl);
    } catch (e) {
      setError(`Authorization could not be completed: ${e instanceof Error ? e.message : String(e)}`);
      setPhase('error');
    }
  }, [stateId]);

  const cancel = useCallback(() => {
    // Nothing to undo: no token is minted until Allow is pressed.
    setPhase('cancelled');
  }, []);

  return (
    <>
      <Head>
        <title>Authorize Claude | FibreFlow</title>
        {/* A consent URL must never be indexed or forwarded as a referrer. */}
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <main className="flex min-h-screen items-center justify-center bg-[var(--ff-bg-primary)] px-4 py-10">
        <McpConsentCard
          phase={phase}
          error={error}
          email={currentUser?.email ?? null}
          onAllow={() => void allow()}
          onCancel={cancel}
        />
      </main>
    </>
  );
}

// Auth is resolved client-side (AuthContext), so there is nothing to fetch here. This
// only opts the page out of static generation, keeping ?state_id= a runtime value.
export const getServerSideProps = async () => ({ props: {} });
