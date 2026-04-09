'use client';

import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import { SOWUploadWizard } from '@/components/sow/SOWUploadWizard';
import { SOWProjectSelector } from './components/SOWProjectSelector';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { log } from '@/lib/logger';
import type { Project } from '@/types/project.types';

export function SOWImportPage() {
  const router = useRouter();
  const { projectId = '', projectName = 'Current Project' } = router.query;
  const projectIdStr = typeof projectId === 'string' ? projectId : '';
  const projectNameStr = typeof projectName === 'string' ? projectName : 'Current Project';
  const [showWizard, setShowWizard] = useState(false);
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);

  // Validate URL parameters
  useEffect(() => {
    const rawProjectId = projectIdStr;
    const rawProjectName = projectNameStr;

    if (rawProjectId) {
      // Validate projectId format (UUID pattern)
      if (!/^[a-f0-9-]{36}$/i.test(rawProjectId)) {
        log.error('Invalid projectId in URL', { projectId: rawProjectId }, 'SOWImportPage');
        setUrlValidationError('Invalid project ID in the URL. Redirecting...');
        setTimeout(() => router.push('/sow/import'), 3000); // Redirect after 3 seconds
        return;
      }
    }

    if (rawProjectName) {
      // Sanitize projectName (decode and limit length)
      try {
        const decodedName = decodeURIComponent(rawProjectName);
        if (decodedName.length > 200) {
          log.warn('Project name too long in URL', { length: decodedName.length }, 'SOWImportPage');
          setUrlValidationError('Project name in URL is too long. Using default name.');
          // Continue with default name
        }
      } catch (error) {
        log.error('Failed to decode projectName from URL', { projectName: rawProjectName, error }, 'SOWImportPage');
        setUrlValidationError('Invalid project name in URL. Using default name.');
        // Continue with default name
      }
    }

    setUrlValidationError(null); // Clear any previous errors
  }, [projectIdStr, projectNameStr, router]);

  // Delay showing the wizard to avoid immediate database calls
  useEffect(() => {
    if (projectIdStr && !urlValidationError) {
      const timer = setTimeout(() => setShowWizard(true), 100);
      return () => clearTimeout(timer);
    }
  }, [projectIdStr, urlValidationError]);

  const handleComplete = () => {
    if (projectIdStr) {
      router.push(`/projects/${projectIdStr}`);
    } else {
      router.push('/sow');
    }
  };

  const handleBack = () => {
    router.back();
  };

  const handleProjectSelect = (project: Project | null) => {
    if (!project?.id) {
      log.warn('Invalid project selected', { project }, 'SOWImportPage');
      return; // Prevent navigation
    }

    // Sanitize project name for URL
    const sanitizedName = project.name
      .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
      .trim()
      .substring(0, 100); // Limit length

    // Navigate to the same page with the selected project
    router.push(`/sow/import?projectId=${project.id}&projectName=${encodeURIComponent(sanitizedName)}`);
  };

  // Fallback component if SOWProjectSelector fails
  const FallbackProjectSelector = () => (
    <div className="text-center p-4 border border-[var(--ff-border-light)] rounded-lg">
      <p className="text-[var(--ff-text-secondary)] mb-2">Unable to load project selector.</p>
      <button
        onClick={() => router.push('/sow')}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Return to SOW List
      </button>
    </div>
  );

  if (!projectIdStr) {
    return (
      <ErrorBoundary
        onError={(error: Error, errorInfo: React.ErrorInfo) => {
          log.error('Error in SOW Import Page (project selection)', { error, errorInfo }, 'SOWImportPage');
        }}
      >
        <div className="min-h-screen bg-[var(--ff-bg-primary)]">
          <div className="p-6">
            <div className="mb-6">
              <button
                onClick={() => router.push('/sow')}
                className="inline-flex items-center text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to SOW List
              </button>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Import SOW Data</h1>
              <p className="text-[var(--ff-text-secondary)] mt-1">Select a project to import scope of work data</p>
            </div>

            <div className="max-w-2xl mx-auto">
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-8">
                {urlValidationError && (
                  <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 rounded-lg">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-red-300">{urlValidationError}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/20 rounded-full mb-4">
                    <FileSpreadsheet className="h-8 w-8 text-blue-600" />
                  </div>
                  <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Select a Project</h2>
                  <p className="text-[var(--ff-text-secondary)]">
                    Choose the project you want to import SOW data for
                  </p>
                </div>

                {selectorError ? (
                  <FallbackProjectSelector />
                ) : (
                  <SOWProjectSelector
                    onProjectSelect={handleProjectSelect}
                    className="mx-auto max-w-sm"
                  />
                )}

                <div className="mt-8 text-center">
                  <p className="text-sm text-[var(--ff-text-tertiary)]">
                    You can import Excel files containing scope of work details, schedules, and other project data
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary
      onError={(error: Error, errorInfo: React.ErrorInfo) => {
        log.error('Error in SOW Import Page (upload wizard)', { error, errorInfo }, 'SOWImportPage');
      }}
    >
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="p-6">
          <div className="mb-6">
            <button
              onClick={handleBack}
              className="inline-flex items-center text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </button>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Import SOW Data</h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">Upload Excel files containing project scope of work data</p>
          </div>
        </div>

        {showWizard && projectIdStr && !urlValidationError && (
          <SOWUploadWizard
            projectId={projectIdStr}
            projectName={projectNameStr}
            onComplete={handleComplete}
          />
        )}

        {urlValidationError && (
          <div className="max-w-2xl mx-auto mt-6">
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-6">
              <div className="flex items-center justify-center">
                <div className="text-center">
                  <h3 className="text-lg font-medium text-red-300 mb-2">URL Validation Error</h3>
                  <p className="text-red-400">{urlValidationError}</p>
                  <button
                    onClick={() => router.push('/sow/import')}
                    className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Go Back to Safe Page
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}