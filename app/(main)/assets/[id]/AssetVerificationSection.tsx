'use client';

/**
 * Asset Verification Section
 *
 * Client component that wraps AssetVerificationPanel for use in the
 * server-rendered Asset Detail page.
 */

import { useRouter } from 'next/navigation';
import { AssetVerificationPanel } from '@/modules/assets/components/AssetVerificationPanel';
import type { VerificationResult } from '@/modules/assets/components/LabelScanner';

interface AssetVerificationSectionProps {
  assetId: string;
  verificationStatus: 'verified' | 'mismatch' | 'pending' | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export function AssetVerificationSection({
  assetId,
  verificationStatus,
  verifiedAt,
  verifiedBy,
}: AssetVerificationSectionProps) {
  const router = useRouter();

  const handleVerificationComplete = (result: VerificationResult) => {
    // Refresh the page to show updated verification status
    router.refresh();
  };

  return (
    <AssetVerificationPanel
      assetId={assetId}
      verificationStatus={verificationStatus}
      verifiedAt={verifiedAt}
      verifiedBy={verifiedBy}
      onVerificationComplete={handleVerificationComplete}
    />
  );
}

export default AssetVerificationSection;
