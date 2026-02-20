import { redirect } from 'next/navigation';

/**
 * QField QA — Deprecated
 * All QField photo data has been migrated to Construction QA.
 * This page now redirects to /construction-qa.
 */
export default function QFieldQaPage() {
  redirect('/construction-qa');
}
