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
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
          <Link href="/contractors" className="hover:text-blue-600 flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Contractors
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">RAG Status Dashboard</h1>
        <p className="text-gray-600 mt-1">
          Red/Amber/Green health monitoring for contractor compliance, performance, and safety
        </p>
      </div>

      {/* Dashboard */}
      <RagDashboard />
    </div>
  );
}
