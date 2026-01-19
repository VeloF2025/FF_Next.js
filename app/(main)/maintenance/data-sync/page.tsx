/**
 * Data Sync Page (Server Component Wrapper)
 *
 * Combined page for QContact Sync and Weekly Import with tabs.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import DataSyncPageClient from './client';

export default function DataSyncPage() {
  return <DataSyncPageClient />;
}
