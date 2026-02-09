/**
 * Contractor RAG Dashboard Page
 * Shows Red/Amber/Green health status for all contractors
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RagDashboard } from '@/modules/rag/components';

export default function RagDashboardPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/contractors" className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] px-3 py-1.5 -ml-3 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Contractors
        </Link>
        <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">RAG Status Dashboard</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">
          Red/Amber/Green health monitoring for contractor compliance, performance, and safety
        </p>
      </div>

      {/* Dashboard */}
      <RagDashboard />
    </div>
  );
}
