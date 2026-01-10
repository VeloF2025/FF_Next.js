/**
 * Create Ticket Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side CreateTicketPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import CreateTicketPageClient from './client';

export default function CreateTicketPage() {
  return <CreateTicketPageClient />;
}
