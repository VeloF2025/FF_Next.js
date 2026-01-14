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

export default function DrPhotoUnifiedPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('all');

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

        {/* Placeholder content */}
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mx-auto max-w-md">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h3 className="mt-2 text-lg font-medium text-gray-900">
              DR Photo Unified Review System
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Phase 4 API endpoints completed. UI integration coming in Phase 5.
            </p>
            <div className="mt-6">
              <a
                href="/wa-monitor"
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                ← Back to WA Monitor
              </a>
            </div>
          </div>
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
      </div>
    </AppLayout>
  );
}
