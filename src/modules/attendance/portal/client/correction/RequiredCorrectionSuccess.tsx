import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

export function RequiredCorrectionSuccess() {
  return (
    <section className="rounded-2xl border border-emerald-700/60 bg-emerald-950/40 p-5 text-emerald-100">
      <CheckCircle2 className="h-8 w-8 text-emerald-400" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold">
        Today&apos;s clock-in is now enabled; supervisor review is pending
      </h1>
      <Link
        href="/my/attendance/clock?action=in"
        className="mt-5 block w-full touch-manipulation rounded-xl bg-emerald-500 px-4 py-3 text-center font-bold text-neutral-950 hover:bg-emerald-400 active:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950"
      >
        Clock in
      </Link>
    </section>
  );
}
