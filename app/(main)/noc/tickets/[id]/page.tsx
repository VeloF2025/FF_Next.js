/**
 * Ticket Detail Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side TicketDetailPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import TicketDetailPageClient from './client';

export default function TicketDetailPage() {
  return <TicketDetailPageClient />;
}
