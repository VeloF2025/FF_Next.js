/**
 * Teams Management Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side TeamsPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import TeamsPageClient from './client';

export default function TeamsPage() {
  return <TeamsPageClient />;
}
