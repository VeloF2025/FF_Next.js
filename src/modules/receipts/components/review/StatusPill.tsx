import type { ReceiptStatus } from '@/modules/receipts/queries';

const TONE: Record<ReceiptStatus, string> = {
  submitted: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  approved: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  rejected: 'bg-red-950/60 text-red-200 border-red-800',
  reconciled: 'bg-blue-500/15 text-blue-200 border-blue-500/40',
};

export function StatusPill({ status }: { status: ReceiptStatus }) {
  return (
    <span className={`inline-block text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full border ${TONE[status]}`}>
      {status}
    </span>
  );
}
