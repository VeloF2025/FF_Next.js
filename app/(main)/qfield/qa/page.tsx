import { redirect } from 'next/navigation';

/**
 * QField QA — Deprecated
 * All QField photo data has been migrated to Civil QA.
 * This page now redirects to /construction-qa.
 */
export default function QFieldQaPage() {
  redirect('/field-ops');
}
