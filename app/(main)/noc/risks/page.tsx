/**
 * Risk Acceptance Review Page (Server Component Wrapper)
 *
 * This is a Server Component that wraps the client-side RiskAcceptanceReviewPageClient.
 * The dynamic export forces dynamic rendering to avoid prerendering issues with Clerk.
 */

export const dynamic = 'force-dynamic';

import RiskAcceptanceReviewPageClient from './client';

export default function RiskAcceptanceReviewPage() {
  return <RiskAcceptanceReviewPageClient />;
}
