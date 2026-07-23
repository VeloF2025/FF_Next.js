/**
 * Incident Detail View - Read-only display of a single H&S incident
 * Used by pages/health-safety/incidents/[id].tsx
 */

import { useRouter } from 'next/router';
import useSWR from 'swr';
import { AlertTriangle } from 'lucide-react';
import { BackLink } from './incident-detail/DetailPrimitives';
import { IncidentHeaderCard } from './incident-detail/IncidentHeaderCard';
import { IncidentClassificationDetails } from './incident-detail/IncidentClassificationDetails';
import { IncidentEvidenceTicket } from './incident-detail/IncidentEvidenceTicket';
import type { IncidentDetail } from './incident-detail/types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

export function IncidentDetailView() {
  const router = useRouter();
  const { id } = router.query;
  const incidentId = typeof id === 'string' ? id : undefined;

  const { data, error, isLoading } = useSWR(
    incidentId ? `/api/health-safety/incidents/${incidentId}` : null,
    fetcher
  );

  const incident = data?.success ? (data.data as IncidentDetail) : undefined;
  const apiError = data && data.success === false ? data.error : null;
  const isNotFound = apiError?.code === 'NOT_FOUND';

  if (isLoading || !incidentId) {
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
            {isNotFound ? 'Incident not found' : apiError?.message || 'Failed to load incident'}
          </p>
        </div>
      </div>
    );
  }

  if (!incident) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <BackLink />
      <IncidentHeaderCard incident={incident} />
      <IncidentClassificationDetails incident={incident} />
      <IncidentEvidenceTicket incident={incident} />
    </div>
  );
}

export default IncidentDetailView;
