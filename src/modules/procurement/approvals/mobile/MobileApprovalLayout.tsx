import { ReactNode } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';

export function MobileApprovalLayout({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-[var(--ff-bg-primary)] flex flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
        <button onClick={() => router.push('/procurement/approvals')} aria-label="Back to approvals"
          className="p-2 -ml-2 rounded-lg hover:bg-[var(--ff-bg-hover)] shrink-0">
          <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
        </button>
        <h1 className="text-base font-semibold text-[var(--ff-text-primary)] truncate">{title}</h1>
      </header>
      <main className="flex-1 overflow-y-auto pb-28">{children}</main>
    </div>
  );
}
