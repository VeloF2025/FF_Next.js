/**
 * Admin batch force-correct page — /procurement/field-stock/serials/force-correct
 *
 * Three-step state machine: compose → preview → result
 * Permission-gated to super_admin or procurement.field-stock.force-correct:edit.
 */

import { useState } from 'react';
import type { NextPage } from 'next';
import Link from 'next/link';
import { AppLayout } from '@/components/layout';
import {
  ComposeStep,
  PreviewStep,
  ResultStep,
  StepIndicator,
  type BatchStep,
} from '@/components/field-stock/ForceCorrectBatchSteps';
import { usePermission } from '@/hooks/usePermission';
import type { ForceCorrectTarget, ForceCorrectResult } from '@/types/field-stock';

// ── Page ─────────────────────────────────────────────────────────────────────

const ForceCorrectAdminPage: NextPage = () => {
  const { can, isLoading } = usePermission();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-neutral-400">
          Checking permissions…
        </div>
      </AppLayout>
    );
  }

  if (!can('procurement.field-stock.force-correct', 'edit')) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-5 py-6 text-center">
            <p className="text-base font-semibold text-red-300">Access denied</p>
            <p className="mt-1 text-sm text-red-400">
              You need the force-correct permission to access this page.
            </p>
            <Link
              href="/procurement/field-stock/serials"
              className="mt-4 inline-block text-sm text-blue-400 hover:underline"
            >
              ← Back to serial register
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 text-sm">
          <Link href="/procurement/field-stock/serials" className="text-blue-400 hover:underline">
            ← Back to serial register
          </Link>
        </div>
        <h1 className="mb-1 text-xl font-semibold">Batch force-correct</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Apply direct DB corrections to one or more serials, bypassing lifecycle rules.
          Every change is audit-logged.
        </p>
        <BatchWizard />
      </div>
    </AppLayout>
  );
};

// ── Wizard ────────────────────────────────────────────────────────────────────

function BatchWizard() {
  const [step, setStep] = useState<BatchStep>('compose');
  const [serialsText, setSerialsText] = useState('');
  const [target, setTarget] = useState<ForceCorrectTarget>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<ForceCorrectResult | null>(null);
  const [applyResult, setApplyResult] = useState<ForceCorrectResult | null>(null);

  const serialLines = serialsText.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasFields = Object.values(target).some((v) => v !== undefined);
  const reasonOk = reason.trim().length >= 10;
  const canPreview = serialLines.length > 0 && hasFields && reasonOk && !busy;

  async function callApi(dryRun: boolean): Promise<ForceCorrectResult> {
    const res = await fetch('/api/procurement/field-stock/serials/force-correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ serials: serialLines, target, reason, dryRun }),
    });
    const json = (await res.json()) as {
      success: boolean;
      data?: ForceCorrectResult;
      error?: { message?: string };
    };
    if (!json.success) throw new Error(json.error?.message ?? 'API error');
    return json.data!;
  }

  async function handlePreview() {
    setError(null);
    setBusy(true);
    try {
      setPreviewResult(await callApi(true));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setError(null);
    setBusy(true);
    try {
      setApplyResult(await callApi(false));
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setSerialsText('');
    setTarget({});
    setReason('');
    setPreviewResult(null);
    setApplyResult(null);
    setError(null);
    setStep('compose');
  }

  return (
    <div>
      <StepIndicator current={step} />
      {error && (
        <div className="my-4 rounded bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
      )}
      {step === 'compose' && (
        <ComposeStep
          serialsText={serialsText}
          serialCount={serialLines.length}
          target={target}
          reason={reason}
          busy={busy}
          canPreview={canPreview}
          onSerialsChange={setSerialsText}
          onTargetChange={setTarget}
          onReasonChange={setReason}
          onPreview={handlePreview}
        />
      )}
      {step === 'preview' && previewResult && (
        <PreviewStep
          result={previewResult}
          busy={busy}
          onBack={() => setStep('compose')}
          onApply={handleApply}
        />
      )}
      {step === 'result' && applyResult && (
        <ResultStep result={applyResult} onReset={handleReset} />
      )}
    </div>
  );
}

export default ForceCorrectAdminPage;
