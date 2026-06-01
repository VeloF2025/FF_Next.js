'use client';

/**
 * PwaComparisonTab
 *
 * Shows photos submitted via the SiteCam app for a DR.
 * Appears as a tab inside UnifiedReviewCard when a PWA submission exists.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

const STEP_LABELS: Record<number, string> = {
  1: 'House Photo', 2: 'Cable from Pole', 3: 'Entry Outside',
  4: 'Entry Inside', 5: 'Wall Mount', 6: 'ONT Back After Install',
  7: 'Power Meter', 8: 'Final Installation', 9: 'Green Lights', 10: 'Signature',
  11: 'Dome Joint Open', 12: 'Dome Joint Closed',
};

interface PwaSubmission {
  submittedAt: string;
  techName: string;
  photoCount: number;
  photoUrls: Record<number, string>;
}

interface ApiResponse {
  success: boolean;
  data?: { submission: PwaSubmission | null };
}

export function PwaComparisonTab({ drNumber }: { drNumber: string }) {
  const [submission, setSubmission] = useState<PwaSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});

  useEffect(() => {
    fetch(`/api/sitecam/submission/${drNumber}`, { credentials: 'include' })
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((d) => {
        if (d.success && d.data?.submission) setSubmission(d.data.submission);
      })
      .catch((err) => {
        log.warn('Failed to load PWA submission', { drNumber, error: String(err) }, 'PwaComparisonTab');
      })
      .finally(() => setLoading(false));
  }, [drNumber]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading PWA submission…
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="text-sm text-gray-400">
          No PWA submission for {drNumber}. Technician has not used the PhotoGuide app for this DR.
        </p>
      </div>
    );
  }

  const steps = Object.entries(STEP_LABELS).map(([num, label]) => ({
    stepNumber: Number(num),
    label,
    url: submission.photoUrls[Number(num)] ?? null,
  }));

  return (
    <div className="space-y-4 p-4">
      <div className="text-xs text-gray-400">
        Submitted {new Date(submission.submittedAt).toLocaleString()} · {submission.techName} ·{' '}
        {submission.photoCount} photo{submission.photoCount !== 1 ? 's' : ''}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {steps.map(({ stepNumber, label, url }) => (
          <div key={stepNumber} className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
            <div className="bg-gray-800 px-2 py-1 text-xs font-medium text-gray-300">
              Step {stepNumber}: {label}
            </div>
            {url && !imgErrors[stepNumber] ? (
              <img
                src={url}
                alt={`Step ${stepNumber}`}
                className="h-32 w-full object-cover"
                loading="lazy"
                onError={() => setImgErrors((prev) => ({ ...prev, [stepNumber]: true }))}
              />
            ) : (
              <div className="flex h-32 items-center justify-center text-xs text-gray-600">
                {url ? 'Image failed to load' : 'No photo'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
