/**
 * Weekly Import Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side WeeklyImportPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import WeeklyImportPageClient from './client';

export default function WeeklyImportPage() {
  return <WeeklyImportPageClient />;
}
