import React from 'react';

import { ApiError, submitMyCorrection } from '../api';
import type { CorrectionHints, CorrectionKind } from '../api';
import { localSastDateTimeToIso } from '../attendanceDateTime';
import { submitRequiredAttendanceCorrection } from '../attendanceStateApi';

export function useCorrectionForm(args: {
  entryId: string;
  exceptionId: string;
  hints: CorrectionHints | null;
  onGenericSuccess: () => Promise<unknown> | unknown;
}) {
  const requiredFlow = Boolean(args.exceptionId);
  const [kind, setKind] = React.useState<CorrectionKind>('forgot_clock_out');
  const [adjustedIn, setAdjustedIn] = React.useState('');
  const [adjustedOut, setAdjustedOut] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const activeHint = args.hints?.[kind] ?? null;
  const minChars = activeHint?.minReasonChars ?? 10;
  const reasonTrimmed = reason.trim();
  const reasonOk = reasonTrimmed.length >= minChars;
  const hasAdjustment = requiredFlow ? Boolean(adjustedOut) : Boolean(adjustedIn) || Boolean(adjustedOut);
  const canSubmit = Boolean(args.entryId) && reasonOk && hasAdjustment && !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (requiredFlow) {
        await submitRequiredAttendanceCorrection({
          entryId: args.entryId,
          exceptionId: args.exceptionId,
          adjustedClockOutAt: localSastDateTimeToIso(adjustedOut),
          reason: reasonTrimmed,
        });
        setConfirmed(true);
      } else {
        await submitMyCorrection({
          entryId: args.entryId,
          adjustmentKind: kind,
          adjustedClockInAt: adjustedIn ? localSastDateTimeToIso(adjustedIn) : null,
          adjustedClockOutAt: adjustedOut ? localSastDateTimeToIso(adjustedOut) : null,
          adjustedSiteGeofenceId: null,
          reason: reasonTrimmed,
        });
        await args.onGenericSuccess();
      }
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error ? error.message : 'Could not submit the correction.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return {
    requiredFlow, kind, setKind, adjustedIn, setAdjustedIn, adjustedOut, setAdjustedOut,
    reason, setReason, submitting, submitError, confirmed, activeHint, minChars,
    reasonTrimmed, reasonOk, canSubmit, handleSubmit,
  };
}

export type CorrectionFormModel = ReturnType<typeof useCorrectionForm>;
