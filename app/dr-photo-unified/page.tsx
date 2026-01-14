/**
 * DR Photo Unified Review Page
 *
 * Main page for unified DR photo review system
 * Combines manual QA + AI evaluation in single interface
 *
 * Features:
 * - List of all unified reviews
 * - Filter by project
 * - Search by drop number
 * - Link to individual review cards
 */

'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/layout';
import { UnifiedReviewCard } from '@/modules/dr-photo-unified/components/UnifiedReviewCard';

export default function DrPhotoUnifiedPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('all');

  // Demo mode: Show a test DR number
  // TODO: Replace with actual list of reviews from database
  const demoDropNumber = 'DR1730550';

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            DR Photo Unified Review
          </h1>
          <p className="mt-2 text-gray-600">
            Unified manual QA and AI evaluation for DR photo reviews
          </p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex gap-4">
          <div className="flex-1">
            <label htmlFor="search" className="sr-only">
              Search drop number
            </label>
            <input
              type="text"
              id="search"
              placeholder="Search by drop number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="w-64">
            <label htmlFor="project" className="sr-only">
              Filter by project
            </label>
            <select
              id="project"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Projects</option>
              <option value="Lawley">Lawley</option>
              <option value="Mohadin">Mohadin</option>
              <option value="Velo Test">Velo Test</option>
              <option value="Mamelodi">Mamelodi</option>
            </select>
          </div>
        </div>

        {/* Demo: Show unified review card */}
        <div className="mb-6">
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="text-sm font-medium text-blue-900">
              ✨ Phase 5 Demo: Unified Review Card
            </h4>
            <p className="mt-1 text-sm text-blue-700">
              Showing demo review for {demoDropNumber}. Full list view coming soon.
            </p>
          </div>

          <UnifiedReviewCard dropNumber={demoDropNumber} />
        </div>

        {/* API Status */}
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <h4 className="text-sm font-medium text-green-900">
            ✅ Phase 4 Complete: API Endpoints Active
          </h4>
          <ul className="mt-2 space-y-1 text-sm text-green-700">
            <li>• POST /api/dr-photo-unified/fetch-photos - Multi-source photo fetching</li>
            <li>• POST /api/dr-photo-unified/evaluate - AI evaluation with VLM</li>
            <li>• POST /api/dr-photo-unified/send-feedback - WhatsApp feedback delivery</li>
          </ul>
        </div>

        {/* Back to WA Monitor */}
        <div className="mt-6 text-center">
          <a
            href="/wa-monitor"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            ← Back to WA Monitor
          </a>
        </div>
      </div>
    </AppLayout>
  );
}
