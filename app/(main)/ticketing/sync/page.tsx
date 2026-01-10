/**
 * QContact Sync Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side QContactSyncPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import QContactSyncPageClient from './client';

export default function QContactSyncPage() {
  return <QContactSyncPageClient />;
}
