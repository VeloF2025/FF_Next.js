/**
 * QField Poles Sync Page
 * /admin/poles-sync
 * Extract and sync poles from all Home projects to QFieldCloud
 */

import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

interface LogEntry {
  type: 'log' | 'error' | 'start' | 'complete';
  message?: string;
  timestamp: string;
  success?: boolean;
  stats?: {
    total_poles: number;
    planted: number;
    surveyed: number;
    unknown: number;
    duplicates_merged: number;
  };
}

interface Project {
  id: string;
  name: string;
}

export default function PolesSyncPage() {
  // State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logViewerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logViewerRef.current) {
      logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight;
    }
  }, [logs]);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/qfield/projects');
      const data = await response.json();

      if (data.success) {
        setProjects(data.projects);
      } else {
        setError('Failed to load projects');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Run Poles sync
  const handleSync = async () => {
    if (!selectedProject) {
      setError('Please select a destination project');
      return;
    }

    setSyncing(true);
    setLogs([]);
    setStats(null);
    setError(null);

    try {
      const response = await fetch('/api/qfield/poles-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: selectedProject,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start sync');
      }

      // Read Server-Sent Events stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            setLogs((prev) => [...prev, data]);

            if (data.type === 'complete') {
              if (data.stats) {
                setStats(data.stats);
              }
              if (data.success) {
                setLastSync(new Date().toISOString());
              } else {
                setError(data.error || 'Sync failed');
              }
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  // Clear logs
  const handleClearLogs = () => {
    setLogs([]);
    setStats(null);
    setError(null);
  };

  return (
    <>
      <Head>
        <title>Poles Sync | FibreFlow</title>
      </Head>

      <div className="min-h-screen bg-[var(--ff-bg-tertiary)] p-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-[var(--ff-text-primary)]">🏗️ Poles Sync Module</h1>
            <p className="mt-2 text-[var(--ff-text-secondary)]">
              Extract and sync poles from all Home projects to QFieldCloud
            </p>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Controls */}
            <div className="lg:col-span-1 space-y-6">
              {/* Project Selection Card */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg p-6">
                <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">📁 Destination Project</h2>

                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  disabled={loading || syncing}
                  className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">-- Select a project --</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>

                <p className="mt-3 text-xs text-[var(--ff-text-tertiary)]">
                  Poles will be added to the selected QFieldCloud project
                </p>
              </div>

              {/* Sync Control Card */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg p-6">
                <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">🚀 Run Sync</h2>

                {lastSync && (
                  <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                    Last sync: {new Date(lastSync).toLocaleString()}
                  </p>
                )}

                <button
                  onClick={handleSync}
                  disabled={syncing || !selectedProject}
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-3 rounded-lg hover:from-purple-700 hover:to-indigo-700 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed transition font-medium shadow-lg"
                >
                  {syncing ? '⏳ Syncing Poles...' : '🚀 Start Poles Sync'}
                </button>

                {syncing && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-2 text-center">
                    This may take 1-2 minutes...
                  </p>
                )}
              </div>

              {/* Stats Card */}
              {stats && (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg p-6">
                  <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">📊 Summary</h2>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Total Poles:</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">{stats.total_poles?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">🟢 Planted:</span>
                      <span className="text-sm font-medium text-green-400">
                        {stats.planted?.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">🔵 Surveyed:</span>
                      <span className="text-sm font-medium text-blue-400">
                        {stats.surveyed?.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">⚪ Unknown:</span>
                      <span className="text-sm font-medium text-[var(--ff-text-secondary)]">
                        {stats.unknown?.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Merged:</span>
                      <span className="text-sm font-medium text-purple-400">
                        {stats.duplicates_merged?.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Legend Card */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg p-6">
                <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">🎨 Layer Colors</h2>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-green-500"></div>
                    <span className="text-sm text-[var(--ff-text-primary)]">Planted Poles</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-blue-500"></div>
                    <span className="text-sm text-[var(--ff-text-primary)]">Surveyed Poles</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-gray-400"></div>
                    <span className="text-sm text-[var(--ff-text-primary)]">Unknown Status</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Logs */}
            <div className="lg:col-span-2">
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg">
                {/* Log Header */}
                <div className="p-4 border-b border-[var(--ff-border-light)] flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">📜 Live Logs</h2>
                  <button
                    onClick={handleClearLogs}
                    className="text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                  >
                    Clear
                  </button>
                </div>

                {/* Log Viewer */}
                <div
                  ref={logViewerRef}
                  className="p-4 h-[600px] overflow-y-auto bg-gray-900 text-gray-100 font-mono text-sm"
                >
                  {logs.length === 0 ? (
                    <p className="text-gray-500">No logs yet. Select a project and run sync.</p>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className="mb-1">
                        {log.type === 'start' && (
                          <div className="text-blue-400">
                            ▶ Starting poles sync...
                          </div>
                        )}

                        {log.type === 'log' && (
                          <div className="text-gray-300">
                            {log.message}
                          </div>
                        )}

                        {log.type === 'error' && (
                          <div className="text-red-400">
                            ❌ {log.message}
                          </div>
                        )}

                        {log.type === 'complete' && (
                          <div className={log.success ? 'text-green-400' : 'text-red-400'}>
                            {log.success ? '✅ Sync complete! Three pole layers added to project.' : '❌ Sync failed'}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Error Alert */}
                {error && (
                  <div className="p-4 bg-red-500/20 border-t border-red-500/50">
                    <p className="text-sm text-red-400">❌ {error}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
