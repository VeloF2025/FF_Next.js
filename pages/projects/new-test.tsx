'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';

export default function NewProjectTestPage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState('');
  const [clientId, setClientId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_code: `PRJ-${Date.now()}`, // Generate a unique project code
          project_name: projectName,
          client_id: clientId || 'af80daa4-fa65-45b6-bdbf-8e05f9ea3520', // Use fibertime as default
          project_type: 'installation',
          status: 'active',
          priority: 'medium',
          start_date: new Date().toISOString(),
          end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          budget: 100000,
          project_manager: '4a7b9ec0-6e18-4f6d-b270-fa2cc3de8886',
          description: 'Test project created from simple form',
          location: null
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert('Project created successfully!');
        router.push('/projects');
      } else {
        // Handle error object properly
        const errorMessage = typeof data.error === 'string' 
          ? data.error 
          : data.error?.message || data.message || 'Failed to create project';
        setError(errorMessage);
      }
    } catch (err) {
      setError('Failed to create project: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-[var(--ff-bg-secondary)] shadow-lg rounded-lg p-8 border border-[var(--ff-border-light)]">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-6">Create New Project (Test)</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="projectName" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Project Name *
            </label>
            <input
              type="text"
              id="projectName"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
              placeholder="Enter project name"
            />
          </div>

          <div>
            <label htmlFor="clientId" className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Client
            </label>
            <select
              id="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            >
              <option value="">Select a client (optional)</option>
              <option value="af80daa4-fa65-45b6-bdbf-8e05f9ea3520">fibertime</option>
            </select>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Will default to fibertime if not selected</p>
          </div>

          {error && (
            <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={isSubmitting || !projectName}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Project'}
            </button>

            <button
              type="button"
              onClick={() => router.push('/projects')}
              className="px-6 py-3 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] border border-[var(--ff-border-light)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>

        <div className="mt-8 p-4 bg-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-300">
            <strong>Note:</strong> This is a simplified test page. The full wizard is at /projects/new
          </p>
        </div>
      </div>
    </div>
  );
}