/**
 * Escalation Management Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side EscalationsPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import EscalationsPageClient from './client';

export default function EscalationsPage() {
  return <EscalationsPageClient />;
}
