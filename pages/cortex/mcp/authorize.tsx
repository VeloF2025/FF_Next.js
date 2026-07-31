import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  CortexMcpConsentCard,
  type CortexMcpConsentPhase,
} from '@/components/cortex/CortexMcpConsentCard';
import { useAuth } from '@/contexts/AuthContext';
import {
  isCortexMcpConsentContext,
  type CortexMcpConsentContext,
} from '@/lib/cortex/mcpConsentContext';

interface ConsentResponse {
  data?: { redirectUrl?: string };
  error?: { message?: string };
}

interface ConsentContextResponse {
  data?: unknown;
}

interface ConsentSubmission {
  stateId: string;
  controller: AbortController;
}

const RETRY_MESSAGE =
  'Authorization could not be completed. Return to Claude and try connecting again.';
const CONTEXT_MESSAGE =
  'Authorization details could not be verified. Return to Claude and try connecting again.';

export default function CortexMcpAuthorizePage() {
  const router = useRouter();
  const { currentUser, isAuthenticated, loading } = useAuth();
  const [phase, setPhase] = useState<CortexMcpConsentPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [attemptedStateId, setAttemptedStateId] = useState('');
  const [verifiedContext, setVerifiedContext] = useState<{
    stateId: string;
    value: CortexMcpConsentContext;
  } | null>(null);
  const rawStateId = router.query.state_id;
  const stateId = typeof rawStateId === 'string' ? rawStateId : '';
  const currentStateId = useRef(stateId);
  const inFlight = useRef<ConsentSubmission | null>(null);
  currentStateId.current = stateId;
  const context = verifiedContext?.stateId === stateId
    ? verifiedContext.value
    : null;
  const displayedPhase = attemptedStateId === stateId ? phase : 'checking';

  useEffect(() => () => {
    const submission = inFlight.current;
    if (submission?.stateId === stateId) {
      submission.controller.abort();
      inFlight.current = null;
    }
  }, [stateId]);

  useEffect(() => {
    if (!router.isReady || loading) return;

    if (!isAuthenticated) {
      void router.replace(
        `/sign-in?returnUrl=${encodeURIComponent(router.asPath)}`,
      );
      return;
    }

    if (!stateId) {
      setAttemptedStateId(stateId);
      setError(
        'This link is missing its authorization reference. Return to Claude and start the connection again.',
      );
      setPhase('error');
      return;
    }

    setAttemptedStateId(stateId);
    setError(null);
    setPhase('checking');
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/cortex/mcp-consent-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stateId }),
        });
        const json = (await response.json().catch(() => null)) as
          | ConsentContextResponse
          | null;
        if (!active) return;
        if (!response.ok || !isCortexMcpConsentContext(json?.data)) {
          setError(CONTEXT_MESSAGE);
          setPhase('error');
          return;
        }
        setVerifiedContext({ stateId, value: json.data });
        setPhase((current) => (current === 'checking' ? 'ready' : current));
      } catch {
        if (!active) return;
        setError(CONTEXT_MESSAGE);
        setPhase('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [router, router.isReady, loading, isAuthenticated, stateId]);

  const allow = useCallback(async () => {
    if (
      inFlight.current
      || !context
      || attemptedStateId !== stateId
      || phase !== 'ready'
    ) return;
    const submission: ConsentSubmission = {
      stateId,
      controller: new AbortController(),
    };
    inFlight.current = submission;
    setPhase('submitting');
    setError(null);

    try {
      const response = await fetch('/api/cortex/mcp-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId }),
        signal: submission.controller.signal,
      });
      const json = (await response.json().catch(() => null)) as ConsentResponse | null;
      if (
        inFlight.current !== submission
        || currentStateId.current !== submission.stateId
      ) return;
      const redirectUrl = json?.data?.redirectUrl;

      if (!response.ok || !redirectUrl) {
        setError(json?.error?.message ?? RETRY_MESSAGE);
        setPhase('error');
        return;
      }

      setPhase('redirecting');
      window.location.assign(redirectUrl);
    } catch (caught) {
      if (
        submission.controller.signal.aborted
        || inFlight.current !== submission
        || currentStateId.current !== submission.stateId
      ) return;
      const reason = caught instanceof Error ? caught.message : String(caught);
      setError(`Authorization could not be completed: ${reason}`);
      setPhase('error');
    } finally {
      if (inFlight.current === submission) inFlight.current = null;
    }
  }, [attemptedStateId, context, phase, stateId]);

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
          phase={displayedPhase}
          error={error}
          email={currentUser?.email ?? null}
          context={context}
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
