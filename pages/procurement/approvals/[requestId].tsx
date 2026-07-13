import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';
import { MobileApprovalLayout } from '@/modules/procurement/approvals/mobile/MobileApprovalLayout';
import { ApprovalSummaryHeader } from '@/modules/procurement/approvals/mobile/ApprovalSummaryHeader';
import { ApprovalDetailPanel } from '@/modules/procurement/approvals/mobile/ApprovalDetailPanel';
import { ApprovalActionBar } from '@/modules/procurement/approvals/mobile/ApprovalActionBar';
import type { ApprovalRequestRecord } from '@/modules/procurement/approvals/mobile/types';

export default function MobileApprovalPage() {
  const router = useRouter();
  const { requestId } = router.query;
  const [record, setRecord] = useState<ApprovalRequestRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/procurement/approvals/${requestId}`);
      if (res.status === 401) {
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(router.asPath)}`;
        return;
      }
      const data = await res.json();
      if (data.success) setRecord(data.data);
      else setError(data.error?.message || 'Failed to load approval');
    } catch (err) {
      log.error('Failed to load approval request', { error: err }, 'procurement');
      setError('Failed to load approval');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (router.isReady && typeof requestId === 'string') load(); }, [router.isReady, requestId]);

  if (!router.isReady || loading) {
    return <MobileApprovalLayout title="Approval">
      <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 rounded-full border-b-2 border-blue-500" /></div>
    </MobileApprovalLayout>;
  }
  if (error || !record) {
    return <MobileApprovalLayout title="Approval">
      <div className="p-6 text-center text-[var(--ff-text-secondary)]">{error || 'Not found'}</div>
    </MobileApprovalLayout>;
  }
  return (
    <MobileApprovalLayout title={record.documentNumber || 'Approval'}>
      <ApprovalSummaryHeader record={record} />
      <ApprovalDetailPanel record={record} />
      <ApprovalActionBar record={record} onActioned={load} />
    </MobileApprovalLayout>
  );
}
