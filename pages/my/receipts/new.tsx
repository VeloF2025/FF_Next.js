/**
 * /my/receipts/new — capture → extract → review → save flow.
 *
 * Two phases backed by /api/my/receipts/extract and .../save:
 *   1. Pick / take a photo. We compress client-side to JPEG ≤1280px,
 *      capture GPS in parallel, and POST multipart to /extract.
 *   2. The extract response prefills the review form. Category dropdown
 *      pre-selects to the VLM's guess (ISAFlow pattern). Staff edits,
 *      picks payment_method, optionally project. Submit POSTs JSON to
 *      /save. On success, redirect to /my/receipts.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { NextPage } from 'next';
import { Camera, Loader2, AlertCircle } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import {
  RECEIPT_CATEGORIES,
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
} from '@/modules/receipts/categories';
import {
  extractReceipt,
  saveReceipt,
  ApiError,
  type ExtractResponse,
  type PaymentMethod,
} from '@/modules/receipts/client/api';
import { compressFileToJpeg } from '@/modules/receipts/client/compressImage';

type Phase =
  | { kind: 'pick' }
  | { kind: 'extracting' }
  | { kind: 'review'; extraction: ExtractResponse }
  | { kind: 'saving'; extraction: ExtractResponse }
  | { kind: 'error'; message: string; back: 'pick' | 'review'; extraction?: ExtractResponse };

interface ReviewFormState {
  receiptDate: string;
  vendor: string;
  totalRand: string;       // string for editing; convert to cents on submit
  vatRand: string;
  category: ReceiptCategory;
  description: string;
  paymentMethod: PaymentMethod;
}

function centsToRandInput(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2);
}

function randInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[Rr\s]/g, '').replace(/,/g, '.');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildInitialForm(extraction: ExtractResponse): ReviewFormState {
  return {
    receiptDate: extraction.date ?? todayIso(),
    vendor: extraction.vendor ?? '',
    totalRand: centsToRandInput(extraction.totalCents),
    vatRand: centsToRandInput(extraction.vatCents),
    category: extraction.categoryGuess,
    description: '',
    paymentMethod: 'company_card',
  };
}

const NewReceiptPage: NextPage & { getLayout?: (p: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ kind: 'pick' });
  const [form, setForm] = React.useState<ReviewFormState | null>(null);
  const [gps, setGps] = React.useState<{ lat: number; lon: number } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Best-effort GPS at mount. Browser will prompt on first capture; if
  // the user denies, we still let them save without coords.
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {
        // user-denied or unavailable — silent, capture will retry on submit
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  const onPickFile = async (file: File) => {
    setPhase({ kind: 'extracting' });
    try {
      const compressed = await compressFileToJpeg(file);
      const extraction = await extractReceipt(compressed);
      setForm(buildInitialForm(extraction));
      setPhase({ kind: 'review', extraction });
    } catch (err) {
      const message = err instanceof ApiError
        ? `Extraction failed: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Could not process photo';
      setPhase({ kind: 'error', message, back: 'pick' });
    }
  };

  const onSubmitReview = async () => {
    const current = phase;
    if (current.kind !== 'review' || !form) return;
    const totalCents = randInputToCents(form.totalRand);
    if (totalCents === null) {
      setPhase({ kind: 'error', message: 'Total amount is required and must be a number.', back: 'review', extraction: current.extraction });
      return;
    }
    setPhase({ kind: 'saving', extraction: current.extraction });
    try {
      await saveReceipt({
        extractionId: current.extraction.extractionId,
        imageUrl: current.extraction.imageUrl,
        imageMime: current.extraction.imageMime,
        receiptDate: form.receiptDate,
        vendor: form.vendor.trim() || null,
        totalCents,
        vatCents: randInputToCents(form.vatRand),
        category: form.category,
        description: form.description.trim() || null,
        paymentMethod: form.paymentMethod,
        projectId: null,
        capturedLat: gps?.lat ?? null,
        capturedLon: gps?.lon ?? null,
        ocrRaw: {
          vendor: current.extraction.vendor,
          totalCents: current.extraction.totalCents,
          vatCents: current.extraction.vatCents,
          date: current.extraction.date,
          lineItems: current.extraction.lineItems,
        },
        ocrCategoryGuess: current.extraction.categoryGuess,
        ocrConfidence: current.extraction.confidence,
      });
      // Land on the list — the new row appears at the top.
      window.location.assign('/my/receipts');
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Save failed';
      setPhase({ kind: 'error', message, back: 'review', extraction: current.extraction });
    }
  };

  return (
    <MyPortalShell title="New receipt">
      {phase.kind === 'pick' && (
        <PickStep
          onPick={onPickFile}
          fileInputRef={fileInputRef}
          gpsAvailable={gps !== null}
        />
      )}

      {phase.kind === 'extracting' && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-neutral-300">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <div className="text-sm">Reading the receipt…</div>
          <div className="text-xs text-neutral-500">Qwen3 is extracting vendor, total, date</div>
        </div>
      )}

      {phase.kind === 'review' && form && (
        <ReviewStep
          extraction={phase.extraction}
          form={form}
          setForm={setForm}
          onSubmit={onSubmitReview}
        />
      )}

      {phase.kind === 'saving' && form && (
        <ReviewStep
          extraction={phase.extraction}
          form={form}
          setForm={setForm}
          onSubmit={onSubmitReview}
          submitting
        />
      )}

      {phase.kind === 'error' && (
        <ErrorPanel
          message={phase.message}
          onRetry={() => {
            if (phase.back === 'review' && phase.extraction && form) {
              setPhase({ kind: 'review', extraction: phase.extraction });
            } else {
              setPhase({ kind: 'pick' });
            }
          }}
          onCancel={() => router.push('/my/receipts')}
        />
      )}
    </MyPortalShell>
  );
};

NewReceiptPage.getLayout = (p) => p;

export default NewReceiptPage;

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function PickStep({
  onPick,
  fileInputRef,
  gpsAvailable,
}: {
  onPick: (file: File) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  gpsAvailable: boolean;
}) {
  return (
    <div className="text-center pt-4 pb-8">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-500/15 text-blue-300 flex items-center justify-center mb-4">
        <Camera className="w-8 h-8" />
      </div>
      <h1 className="text-xl font-semibold text-neutral-100 mb-1">Take a photo of the receipt</h1>
      <p className="text-sm text-neutral-400 mb-6">
        We&rsquo;ll read the vendor, total and date automatically. You can edit anything before saving.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold"
      >
        <Camera className="w-5 h-5" />
        Take photo
      </button>

      <div className="mt-4 text-xs text-neutral-500">
        {gpsAvailable
          ? 'GPS captured ✓'
          : 'GPS not available — receipt will save without coordinates'}
      </div>
    </div>
  );
}

function ReviewStep({
  extraction,
  form,
  setForm,
  onSubmit,
  submitting = false,
}: {
  extraction: ExtractResponse;
  form: ReviewFormState;
  setForm: (next: ReviewFormState) => void;
  onSubmit: () => void;
  submitting?: boolean;
}) {
  const categoryIsVlmSuggestion = form.category === extraction.categoryGuess;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      {!extraction.vlmSuccess && (
        <div role="alert" className="rounded-lg bg-amber-950/50 border border-amber-800 px-3 py-2 text-sm text-amber-200">
          We couldn&rsquo;t auto-read this receipt. Fill in the fields manually.
        </div>
      )}

      <Field label="Vendor" hint="Where you bought it">
        <input
          type="text"
          value={form.vendor}
          onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          placeholder="e.g. Engen Pretoria North"
          className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input
            type="date"
            value={form.receiptDate}
            onChange={(e) => setForm({ ...form, receiptDate: e.target.value })}
            required
            className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
          />
        </Field>
        <Field label="Total (R)">
          <input
            type="text"
            inputMode="decimal"
            value={form.totalRand}
            onChange={(e) => setForm({ ...form, totalRand: e.target.value })}
            placeholder="0.00"
            required
            className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none tabular-nums"
          />
        </Field>
      </div>

      <Field label="VAT (R)" hint="Optional — leave blank if not shown on the slip">
        <input
          type="text"
          inputMode="decimal"
          value={form.vatRand}
          onChange={(e) => setForm({ ...form, vatRand: e.target.value })}
          placeholder="0.00"
          className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none tabular-nums"
        />
      </Field>

      <Field
        label="Category"
        hint={
          categoryIsVlmSuggestion ? (
            <span className="inline-flex items-center gap-1 text-blue-300">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400" />
              VLM suggested based on the receipt
            </span>
          ) : (
            'You overrode the suggestion'
          )
        }
      >
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value as ReceiptCategory })}
          className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
        >
          {RECEIPT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {RECEIPT_CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note" hint="Optional — e.g. who you were with, what it was for">
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Optional"
          className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
        />
      </Field>

      <Field label="Paid with">
        <div className="grid grid-cols-2 gap-2">
          <PayChoice
            value="company_card"
            label="Company card"
            current={form.paymentMethod}
            onSelect={(v) => setForm({ ...form, paymentMethod: v })}
          />
          <PayChoice
            value="personal_reimbursement"
            label="My money"
            current={form.paymentMethod}
            onSelect={(v) => setForm({ ...form, paymentMethod: v })}
          />
        </div>
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold mt-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {submitting ? 'Saving…' : 'Save receipt'}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-200 mb-1">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-neutral-400 mt-1">{hint}</span> : null}
    </label>
  );
}

function PayChoice({
  value,
  label,
  current,
  onSelect,
}: {
  value: PaymentMethod;
  label: string;
  current: PaymentMethod;
  onSelect: (v: PaymentMethod) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`min-h-[48px] px-3 py-2 rounded-lg border text-sm font-medium transition ${
        active
          ? 'bg-blue-600 border-blue-500 text-white'
          : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-500'
      }`}
    >
      {label}
    </button>
  );
}

function ErrorPanel({
  message,
  onRetry,
  onCancel,
}: {
  message: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 pt-6">
      <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{message}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 inline-flex items-center justify-center min-h-[48px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 inline-flex items-center justify-center min-h-[48px] rounded-lg border border-neutral-700 text-neutral-200 hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
