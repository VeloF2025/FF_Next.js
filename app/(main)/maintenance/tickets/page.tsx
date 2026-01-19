/**
 * Ticket List Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side TicketsListPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import TicketsListPageClient from './client';

export default function TicketsListPage() {
  return <TicketsListPageClient />;
}
