import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  CortexMcpConsentCard,
  type CortexMcpConsentPhase,
} from '@/components/cortex/CortexMcpConsentCard';
import { useAuth } from '@/contexts/AuthContext';

interface ConsentResponse {
  data?: { redirectUrl?: string };
  error?: { message?: string };
}

const RETRY_MESSAGE =
  'Authorization could not be completed. Return to Claude and try connecting again.';

export default function CortexMcpAuthorizePage() {
  const router = useRouter();
  const { currentUser, isAuthenticated, loading } = useAuth();
  const [phase, setPhase] = useState<CortexMcpConsentPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const rawStateId = router.query.state_id;
  const stateId = typeof rawStateId === 'string' ? rawStateId : '';

  useEffect(() => {
    if (!router.isReady || loading) return;

    if (!isAuthenticated) {
      void router.replace(
        `/sign-in?returnUrl=${encodeURIComponent(router.asPath)}`,
      );
      return;
    }

    if (!stateId) {
      setError(
        'This link is missing its authorization reference. Return to Claude and start the connection again.',
      );
      setPhase('error');
      return;
    }

    setPhase((current) => (current === 'checking' ? 'ready' : current));
  }, [router, router.isReady, loading, isAuthenticated, stateId]);

  const allow = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('submitting');
    setError(null);

    try {
      const response = await fetch('/api/cortex/mcp-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId }),
      });
      const json = (await response.json().catch(() => null)) as ConsentResponse | null;
      const redirectUrl = json?.data?.redirectUrl;

      if (!response.ok || !redirectUrl) {
        setError(json?.error?.message ?? RETRY_MESSAGE);
        setPhase('error');
        return;
      }

      setPhase('redirecting');
      window.location.assign(redirectUrl);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setError(`Authorization could not be completed: ${reason}`);
      setPhase('error');
    }
  }, [stateId]);

  const cancel = useCallback(() => {
    setPhase('cancelled');
  }, []);

  return (
    <>
      <Head>
        <title>Authorize Cortex Knowledge | FibreFlow</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <main className="flex min-h-screen items-center justify-center bg-[var(--ff-bg-primary)] px-4 py-10">
        <CortexMcpConsentCard
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

// Next.js requires this named page export to opt the route into SSR.
// eslint-disable-next-line react-refresh/only-export-components
export const getServerSideProps = async () => ({ props: {} });
