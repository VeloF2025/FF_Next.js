/**
 * Data Sync Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side DataSyncPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues.
 */

export const dynamic = 'force-dynamic';

import DataSyncPageClient from './client';

export default function DataSyncPage() {
  return <DataSyncPageClient />;
}
