/**
 * /my/receipts/[id] — detail view + inline edit.
 *
 * Editable while status='submitted'; once finance acts on the row
 * (approved/rejected/reconciled) the form locks and shows a banner.
 *
 * Loads the receipt by hitting /api/my/receipts (the list endpoint)
 * and filtering — keeps PR2 endpoint surface minimal. PR3 might add a
 * dedicated GET /api/my/receipts/[id] when finance review needs the
 * full row server-side.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { NextPage } from 'next';
import { Receipt, Eye, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import {
  RECEIPT_CATEGORIES,
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
} from '@/modules/receipts/categories';
import {
  listMyReceipts,
  receiptDownloadUrl,
  editMyReceipt,
  ApiError,
  type ReceiptListItem,
  type PaymentMethod,
} from '@/modules/receipts/client/api';

interface FormState {
  receiptDate: string;
  vendor: string;
  totalRand: string;
  vatRand: string;
  category: ReceiptCategory;
  description: string;
  paymentMethod: PaymentMethod;
}

function centsToRand(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2);
}

function randToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[Rr\s]/g, '').replace(/,/g, '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

const ReceiptDetailPage: NextPage & { getLayout?: (p: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : null;

  const [row, setRow] = React.useState<ReceiptListItem | null>(null);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    listMyReceipts()
      .then((res) => {
        if (cancelled) return;
        const found = res.items.find((r) => r.id === id) ?? null;
        if (!found) {
          setError('Receipt not found');
        } else {
          setRow(found);
          setForm({
            receiptDate: found.receiptDate,
            vendor: found.vendor ?? '',
            totalRand: centsToRand(found.totalCents),
            vatRand: centsToRand(found.vatCents),
            category: found.category as ReceiptCategory,
            description: '',
            paymentMethod: found.paymentMethod as PaymentMethod,
          });
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load receipt');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const editable = row?.status === 'submitted';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !form || !row) return;
    const totalCents = randToCents(form.totalRand);
    if (totalCents === null) {
      setError('Total must be a number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await editMyReceipt(id, {
        receiptDate: form.receiptDate,
        vendor: form.vendor.trim() || null,
        totalCents,
        vatCents: randToCents(form.vatRand),
        category: form.category,
        description: form.description.trim() || null,
        paymentMethod: form.paymentMethod,
      });
      router.push('/my/receipts');
    } catch (err) {
      setSaving(false);
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <MyPortalShell title="Receipt">
      <button
        type="button"
        onClick={() => router.push('/my/receipts')}
        className="inline-flex items-center gap-1 min-h-[48px] px-2 -ml-2 mb-3 text-sm text-neutral-400 hover:text-neutral-100"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {loading && (
        <div className="flex items-center justify-center py-12 text-sm text-neutral-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      )}

      {error && !loading && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200 mb-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {row && form && (
        <>
          {!editable && (
            <div className="rounded-lg bg-neutral-800/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-300 mb-4">
              This receipt has been {row.status}. Contact finance if you need to make changes.
            </div>
          )}

          {row.hasImage && (
            <a
              href={receiptDownloadUrl(row.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 min-h-[48px] px-4 mb-4 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 text-sm font-medium hover:bg-blue-500/25"
            >
              <Eye className="w-4 h-4" />
              View original
            </a>
          )}

          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Vendor">
              <input
                type="text"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                disabled={!editable}
                className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 disabled:opacity-60 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input
                  type="date"
                  value={form.receiptDate}
                  onChange={(e) => setForm({ ...form, receiptDate: e.target.value })}
                  disabled={!editable}
                  className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 disabled:opacity-60 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
                />
              </Field>
              <Field label="Total (R)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.totalRand}
                  onChange={(e) => setForm({ ...form, totalRand: e.target.value })}
                  disabled={!editable}
                  className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 disabled:opacity-60 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none tabular-nums"
                />
              </Field>
            </div>

            <Field label="VAT (R)">
              <input
                type="text"
                inputMode="decimal"
                value={form.vatRand}
                onChange={(e) => setForm({ ...form, vatRand: e.target.value })}
                disabled={!editable}
                placeholder="Optional"
                className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder:text-neutral-500 disabled:opacity-60 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none tabular-nums"
              />
            </Field>

            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as ReceiptCategory })}
                disabled={!editable}
                className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 disabled:opacity-60 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
              >
                {RECEIPT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {RECEIPT_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Note">
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={!editable}
                placeholder="Optional"
                className="w-full px-3 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder:text-neutral-500 disabled:opacity-60 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none"
              />
            </Field>

            <Field label="Paid with">
              <div className="grid grid-cols-2 gap-2">
                {(['company_card', 'personal_reimbursement'] as PaymentMethod[]).map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    disabled={!editable}
                    onClick={() => setForm({ ...form, paymentMethod: pm })}
                    className={`min-h-[48px] px-3 py-2 rounded-lg border text-sm font-medium transition disabled:opacity-60 ${
                      form.paymentMethod === pm
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-neutral-500'
                    }`}
                  >
                    {pm === 'company_card' ? 'Company card' : 'My money'}
                  </button>
                ))}
              </div>
            </Field>

            {editable && (
              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold mt-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </form>
        </>
      )}
    </MyPortalShell>
  );
};

ReceiptDetailPage.getLayout = (p) => p;

export default ReceiptDetailPage;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-neutral-200 mb-1">{label}</span>
      {children}
    </label>
  );
}
