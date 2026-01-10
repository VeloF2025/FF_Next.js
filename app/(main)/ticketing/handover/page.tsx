/**
 * Handover Center Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side HandoverCenterPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import HandoverCenterPageClient from './client';

export default function HandoverCenterPage() {
  return <HandoverCenterPageClient />;
}
