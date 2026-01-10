/**
 * Ticketing Dashboard Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side TicketingPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import TicketingPageClient from './client';

export default function TicketingPage() {
  return <TicketingPageClient />;
}
