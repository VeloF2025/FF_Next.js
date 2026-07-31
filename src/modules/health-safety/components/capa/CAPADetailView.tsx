/**
 * CAPA Detail View - full read view + status-change control
 * Used by pages/health-safety/capa/[id].tsx
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AlertTriangle, ChevronLeft } from 'lucide-react';
import { CAPADetailHeader } from './CAPADetailHeader';
import { CAPADetailInfo } from './CAPADetailInfo';
import { CAPAComments } from './CAPAComments';
import { CAPAStatusChangeForm } from './CAPAStatusChangeForm';
import type { CAPA, CAPAComment } from '@/modules/health-safety/types/capa.types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

export function CAPADetailView() {
  const router = useRouter();
  const { id } = router.query;
  const capaId = typeof id === 'string' ? id : undefined;

  const { data, error, isLoading, mutate } = useSWR(
    capaId ? `/api/health-safety/capa/${capaId}` : null,
    fetcher
  );

  const capa = data?.success ? (data.data.capa as CAPA & { is_overdue?: boolean }) : undefined;
  const comments = data?.success ? ((data.data.comments as CAPAComment[]) || []) : [];
  const apiError = data && data.success === false ? data.error : null;
  const isNotFound = apiError?.code === 'NOT_FOUND';

  if (isLoading || !capaId) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || apiError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <p className="text-red-600 dark:text-red-400 font-medium">
            {isNotFound ? 'CAPA not found' : apiError?.message || 'Failed to load CAPA'}
          </p>
        </div>
      </div>
    );
  }

  if (!capa) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <CAPADetailHeader capa={capa} />
      <CAPADetailInfo capa={capa} />
      <CAPAStatusChangeForm capaId={capa.id} currentStatus={capa.status} onSuccess={() => mutate()} />
      <CAPAComments comments={comments} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/health-safety/capa"
      className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      Back to Corrective Actions
    </Link>
  );
}

export default CAPADetailView;
