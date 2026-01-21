/**
 * QField OES Sync Page - v6 with Server Controls Tab
 * /admin/qfield-sync
 * Upload OES reports and trigger automated sync to QFieldCloud
 * + Admin control panel for authorized users
 *
 * Version: 6.0
 * Date: 2026-01-21
 * Features: Project selection, create new projects, auto-layer config, real-time logs, server controls
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { notificationService } from '@/services/core/NotificationService';

// Authorized users for Server Controls tab
const AUTHORIZED_USERS = [
  'louis@velocityfibre.co.za',
  'hein@velocityfibre.co.za',
  'jaun@velocityfibre.co.za',
  'louisdup@gmail.com', // Louis personal
  'admin@fibreflow.app', // Generic admin
];

// Server Controls interfaces
interface ServiceStatus {
  containers: { total: number; running: number; list: Array<{ name: string; status: string }> };
  database: { connected: boolean; stats: Record<string, number> };
  minio: { live: boolean };
  jobs: { pending: number; queued: number; stuck: Array<{ id: string; type: string; status: string; project: string; createdAt: string }> };
}

interface JobStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  queued: number;
  avgDurationSec: number | null;
  successRate: number;
}

interface JobDetails {
  id: string;
  type: string;
  status: string;
  project: string;
  projectId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  output: string | null;
}

interface ProjectDetails {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  jobCount: number;
  lastJobStatus: string | null;
  lastJobDate: string | null;
}

interface LogEntry {
  type: 'log' | 'error' | 'start' | 'complete';
  message?: string;
  timestamp: string;
  success?: boolean;
  stats?: {
    extracted: number;
    matched: number;
    uploaded: number;
    errors: number;
    warnings: number;
  };
}

interface Project {
  id: string;
  name: string;
  owner?: string;
}

export default function QFieldSyncPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<'sync' | 'server-controls'>('sync');

  // OES Sync State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logViewerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Server Controls State
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [jobLookupId, setJobLookupId] = useState('');
  const [projectLookupId, setProjectLookupId] = useState('');
  const [jobDetails, setJobDetails] = useState<JobDetails | null>(null);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Check if current user is authorized for Server Controls
  // In dev mode, allow all users; in production, check whitelist
  const isAuthorizedForServerControls = true; // Dev mode - always true
  // TODO: Replace with actual auth check when auth is enabled:
  // const { user } = useAuth();
  // const isAuthorizedForServerControls = user?.email && AUTHORIZED_USERS.includes(user.email);

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
      setLoadingProjects(true);
      const response = await fetch('/api/qfield/projects');
      const data = await response.json();

      if (data.success && data.projects) {
        setProjects(data.projects);
      } else {
        setError('Failed to load projects');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      notificationService.warning('Project name is required');
      return;
    }

    setCreatingProject(true);
    try {
      const response = await fetch('/api/qfield/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName.trim(),
          description: newProjectDesc.trim() || `OES Sync - ${newProjectName.trim()}`
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      // Reload projects and select the new one
      await loadProjects();
      setSelectedProjectId(data.project.id);
      setShowCreateForm(false);
      setNewProjectName('');
      setNewProjectDesc('');
      notificationService.success(`Project "${newProjectName}" created successfully`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      notificationService.error(`Failed to create project: ${message}`);
    } finally {
      setCreatingProject(false);
    }
  };

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setUploadSuccess(false);
      setError(null);
    }
  };

  // Handle drag & drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setUploadSuccess(false);
      setError(null);
    }
  };

  // Upload file to VPS
  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    setUploadSuccess(false);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/qfield/oes-upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setUploadSuccess(true);
      setError(null);
      console.log('Upload successful:', data);
    } catch (err: any) {
      setError(err.message);
      setUploadSuccess(false);
    } finally {
      setUploading(false);
    }
  };

  // Run OES sync
  const handleSync = async () => {
    if (!selectedProjectId) {
      notificationService.warning('Please select a destination project first');
      return;
    }

    setSyncing(true);
    setLogs([]);
    setStats(null);
    setError(null);

    try {
      const response = await fetch('/api/qfield/oes-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId }),
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

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
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
            } catch (e) {
              console.error('Failed to parse log:', e);
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

  // === SERVER CONTROLS FUNCTIONS ===

  const loadServerStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, statsRes] = await Promise.all([
        fetch('/api/qfield'),
        fetch('/api/qfield', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'job-stats' }) }),
      ]);

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setServiceStatus(statusData.data);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.data?.stats) {
          setJobStats(statsData.data.stats);
        }
      }
    } catch (err) {
      console.error('Failed to load server status:', err);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Load server status when switching to Server Controls tab
  useEffect(() => {
    if (activeTab === 'server-controls' && isAuthorizedForServerControls) {
      loadServerStatus();
    }
  }, [activeTab, isAuthorizedForServerControls, loadServerStatus]);

  const handleRestartWorkers = async () => {
    if (!confirm('⚠️ Restart all QFieldCloud workers?\n\nThis will briefly interrupt job processing (10-30 seconds).\n\nContinue?')) {
      return;
    }

    setActionInProgress('restart-workers');
    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart-workers' }),
      });
      const data = await res.json();

      if (data.data?.success) {
        notificationService.success(data.data.message);
        await loadServerStatus();
      } else {
        notificationService.error(data.data?.message || 'Failed to restart workers');
      }
    } catch (err) {
      notificationService.error('Failed to restart workers');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRestartApp = async () => {
    if (!confirm('⚠️ Restart the QFieldCloud app container?\n\nThis will cause 1-2 minutes of downtime.\n\nAre you sure?')) {
      return;
    }

    setActionInProgress('restart-app');
    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart-app' }),
      });
      const data = await res.json();

      if (data.data?.success) {
        notificationService.success(data.data.message);
        await loadServerStatus();
      } else {
        notificationService.error(data.data?.message || 'Failed to restart app');
      }
    } catch (err) {
      notificationService.error('Failed to restart app container');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleClearStuckJobs = async () => {
    const stuckCount = (serviceStatus?.jobs.pending || 0) + (serviceStatus?.jobs.queued || 0);
    if (stuckCount === 0) {
      notificationService.info('No stuck jobs to clear');
      return;
    }

    if (!confirm(`⚠️ Clear ${stuckCount} stuck job(s)?\n\nThis will mark them as failed so new jobs can process.\n\nContinue?`)) {
      return;
    }

    setActionInProgress('clear-jobs');
    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-jobs' }),
      });
      const data = await res.json();

      if (data.data?.success) {
        notificationService.success(`Cleared ${data.data.cleared} stuck job(s)`);
        await loadServerStatus();
      } else {
        notificationService.error('Failed to clear stuck jobs');
      }
    } catch (err) {
      notificationService.error('Failed to clear stuck jobs');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleJobLookup = async () => {
    if (!jobLookupId.trim()) {
      setLookupError('Please enter a Job ID');
      return;
    }

    setLookupError(null);
    setJobDetails(null);

    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-job', jobId: jobLookupId.trim() }),
      });
      const data = await res.json();

      if (data.data?.success && data.data.job) {
        setJobDetails(data.data.job);
      } else {
        setLookupError(data.data?.error || 'Job not found');
      }
    } catch (err) {
      setLookupError('Failed to lookup job');
    }
  };

  const handleProjectLookup = async () => {
    if (!projectLookupId.trim()) {
      setLookupError('Please enter a Project ID');
      return;
    }

    setLookupError(null);
    setProjectDetails(null);

    try {
      const res = await fetch('/api/qfield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-project', projectId: projectLookupId.trim() }),
      });
      const data = await res.json();

      if (data.data?.success && data.data.project) {
        setProjectDetails(data.data.project);
      } else {
        setLookupError(data.data?.error || 'Project not found');
      }
    } catch (err) {
      setLookupError('Failed to lookup project');
    }
  };

  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return '-';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <>
      <Head>
        <title>QField Admin v6 | FibreFlow</title>
      </Head>

      <div className="min-h-screen bg-[var(--ff-bg-tertiary)] p-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">QField Admin v6</h1>
            <p className="mt-2 text-[var(--ff-text-secondary)]">
              OES sync and server administration
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('sync')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                activeTab === 'sync'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              📤 OES Sync
            </button>
            {isAuthorizedForServerControls && (
              <button
                onClick={() => setActiveTab('server-controls')}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  activeTab === 'server-controls'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]'
                }`}
              >
                🖥️ Server Controls
              </button>
            )}
          </div>

          {/* Tab Content */}
          {activeTab === 'sync' && (
          /* OES Sync Tab */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Project, Upload & Sync */}
            <div className="lg:col-span-1 space-y-6">
              {/* Project Selection Card */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">🎯 QFieldCloud Project</h2>

                {/* Project Dropdown */}
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full p-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg mb-2 hover:border-gray-500"
                  disabled={loadingProjects}
                >
                  <option value="">
                    {loadingProjects ? 'Loading projects...' : 'Select a project...'}
                  </option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} {project.owner ? `(${project.owner})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--ff-text-tertiary)] mb-3">
                  {projects.length} projects available
                </p>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={loadProjects}
                    disabled={loadingProjects}
                    className="flex-1 bg-green-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    🔄 Refresh
                  </button>
                  <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700"
                  >
                    ➕ New Project
                  </button>
                </div>

                {/* Create Project Form */}
                {showCreateForm && (
                  <div className="mt-4 p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                    <input
                      type="text"
                      placeholder="Project Name (e.g., OES_2025_01)"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      className="w-full p-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded mb-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Description (optional)"
                      value={newProjectDesc}
                      onChange={(e) => setNewProjectDesc(e.target.value)}
                      className="w-full p-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded mb-3 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreateProject}
                        disabled={creatingProject}
                        className="flex-1 bg-green-600 text-white px-3 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {creatingProject ? 'Creating...' : 'Create'}
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateForm(false);
                          setNewProjectName('');
                          setNewProjectDesc('');
                        }}
                        className="flex-1 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] px-3 py-2 rounded text-sm hover:bg-[var(--ff-bg-hover)] border border-[var(--ff-border-light)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* File Upload Card */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">📂 Upload OES Report</h2>

                {/* Drag & Drop Area */}
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[var(--ff-border-light)] rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {file ? (
                    <div>
                      <p className="text-sm font-medium text-[var(--ff-text-primary)]">{file.name}</p>
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-[var(--ff-text-secondary)]">
                        Click or drag file here
                      </p>
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                        Excel (.xlsx, .xls) or CSV
                      </p>
                    </div>
                  )}
                </div>

                {/* Upload Button */}
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="mt-4 w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {uploading ? 'Uploading...' : 'Upload to VPS'}
                </button>

                {/* Upload Success */}
                {uploadSuccess && (
                  <div className="mt-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                    <p className="text-sm text-green-400">✅ File uploaded successfully</p>
                  </div>
                )}
              </div>

              {/* Sync Control Card */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">🚀 Run Sync</h2>

                {lastSync && (
                  <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
                    Last sync: {new Date(lastSync).toLocaleString()}
                  </p>
                )}

                <button
                  onClick={handleSync}
                  disabled={syncing || !selectedProjectId}
                  className="w-full bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
                >
                  {syncing ? '⏳ Syncing...' : '🚀 Run OES Sync Now'}
                </button>

                {syncing && (
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-2 text-center">
                    This may take 2-3 minutes...
                  </p>
                )}

                {!selectedProjectId && (
                  <p className="text-xs text-yellow-600 mt-2 text-center">
                    ⚠️ Select a project first
                  </p>
                )}
              </div>

              {/* Stats Card */}
              {stats && (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">📊 Summary</h2>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Extracted:</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">{stats.extracted.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Matched:</span>
                      <span className="text-sm font-medium text-green-600">
                        {stats.matched.toLocaleString()}
                      </span>
                    </div>
                    {stats.matched > 0 && stats.extracted > 0 && (
                      <div className="flex justify-between">
                        <span className="text-sm text-[var(--ff-text-secondary)]">Match Rate:</span>
                        <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                          {((stats.matched / stats.extracted) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Warnings:</span>
                      <span className="text-sm font-medium text-yellow-600">{stats.warnings}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Errors:</span>
                      <span className="text-sm font-medium text-red-600">{stats.errors}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Logs */}
            <div className="lg:col-span-2">
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow">
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
                    <p className="text-gray-500">No logs yet. Upload a file and run sync.</p>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className="mb-1">
                        {log.type === 'start' && (
                          <div className="text-blue-400">
                            ▶ Starting OES sync...
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
                            {log.success ? '✅ Sync complete!' : '❌ Sync failed'}
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
          )}

          {/* Server Controls Tab */}
          {activeTab === 'server-controls' && isAuthorizedForServerControls && (
            <div className="space-y-6">
              {/* Top Row - Status, Controls, Lookup */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Service Status Card */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">🔍 Service Status</h2>
                    <button
                      onClick={loadServerStatus}
                      disabled={loadingStatus}
                      className="text-sm text-blue-500 hover:text-blue-400 disabled:opacity-50"
                    >
                      {loadingStatus ? '...' : '🔄 Refresh'}
                    </button>
                  </div>

                  {loadingStatus && !serviceStatus ? (
                    <p className="text-[var(--ff-text-secondary)]">Loading...</p>
                  ) : serviceStatus ? (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[var(--ff-text-secondary)]">Workers</span>
                        <span className={`text-sm font-medium ${
                          serviceStatus.containers.running >= 8 ? 'text-green-500' : 'text-yellow-500'
                        }`}>
                          {serviceStatus.containers.list.filter(c => c.name.includes('worker')).length}/8
                          {serviceStatus.containers.running >= 8 ? ' ✅' : ' ⚠️'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[var(--ff-text-secondary)]">App Container</span>
                        <span className={`text-sm font-medium ${
                          serviceStatus.containers.list.some(c => c.name.includes('app') && c.status.includes('Up'))
                            ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {serviceStatus.containers.list.some(c => c.name.includes('app') && c.status.includes('Up'))
                            ? 'Running ✅' : 'Down ❌'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[var(--ff-text-secondary)]">Database</span>
                        <span className={`text-sm font-medium ${
                          serviceStatus.database.connected ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {serviceStatus.database.connected ? 'Connected ✅' : 'Disconnected ❌'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[var(--ff-text-secondary)]">MinIO Storage</span>
                        <span className={`text-sm font-medium ${
                          serviceStatus.minio.live ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {serviceStatus.minio.live ? 'Live ✅' : 'Down ❌'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-[var(--ff-text-secondary)]">Stuck Jobs</span>
                        <span className={`text-sm font-medium ${
                          (serviceStatus.jobs.pending + serviceStatus.jobs.queued) === 0
                            ? 'text-green-500' : 'text-yellow-500'
                        }`}>
                          {serviceStatus.jobs.pending + serviceStatus.jobs.queued}
                          {(serviceStatus.jobs.pending + serviceStatus.jobs.queued) === 0 ? ' ✅' : ' ⚠️'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[var(--ff-text-tertiary)]">Click refresh to load status</p>
                  )}
                </div>

                {/* Worker Controls Card */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">⚙️ Worker Controls</h2>

                  <div className="space-y-3">
                    <button
                      onClick={handleRestartWorkers}
                      disabled={actionInProgress !== null}
                      className="w-full bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                    >
                      {actionInProgress === 'restart-workers' ? (
                        <>⏳ Restarting...</>
                      ) : (
                        <>🔄 Restart Workers</>
                      )}
                    </button>

                    <button
                      onClick={handleClearStuckJobs}
                      disabled={actionInProgress !== null}
                      className="w-full bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                    >
                      {actionInProgress === 'clear-jobs' ? (
                        <>⏳ Clearing...</>
                      ) : (
                        <>🧹 Clear Stuck Jobs</>
                      )}
                    </button>

                    <button
                      onClick={handleRestartApp}
                      disabled={actionInProgress !== null}
                      className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                    >
                      {actionInProgress === 'restart-app' ? (
                        <>⏳ Restarting...</>
                      ) : (
                        <>🔴 Restart App Container</>
                      )}
                    </button>
                  </div>

                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-4">
                    ⚠️ All actions require confirmation
                  </p>
                </div>

                {/* Lookup Card */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">🔎 Lookup</h2>

                  <div className="space-y-4">
                    {/* Job Lookup */}
                    <div>
                      <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Job ID</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={jobLookupId}
                          onChange={(e) => setJobLookupId(e.target.value)}
                          placeholder="Enter job ID..."
                          className="flex-1 p-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-sm"
                        />
                        <button
                          onClick={handleJobLookup}
                          className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                        >
                          Find
                        </button>
                      </div>
                    </div>

                    {/* Project Lookup */}
                    <div>
                      <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">Project ID</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={projectLookupId}
                          onChange={(e) => setProjectLookupId(e.target.value)}
                          placeholder="Enter project ID..."
                          className="flex-1 p-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded text-sm"
                        />
                        <button
                          onClick={handleProjectLookup}
                          className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                        >
                          Find
                        </button>
                      </div>
                    </div>

                    {/* Lookup Error */}
                    {lookupError && (
                      <p className="text-sm text-red-500">{lookupError}</p>
                    )}

                    {/* Job Details */}
                    {jobDetails && (
                      <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded text-sm">
                        <p className="font-medium text-[var(--ff-text-primary)] mb-2">Job Found:</p>
                        <div className="space-y-1 text-[var(--ff-text-secondary)]">
                          <p><span className="text-[var(--ff-text-tertiary)]">ID:</span> {jobDetails.id}</p>
                          <p><span className="text-[var(--ff-text-tertiary)]">Type:</span> {jobDetails.type}</p>
                          <p><span className="text-[var(--ff-text-tertiary)]">Status:</span> <span className={
                            jobDetails.status === 'finished' ? 'text-green-500' :
                            jobDetails.status === 'failed' ? 'text-red-500' : 'text-yellow-500'
                          }>{jobDetails.status}</span></p>
                          <p><span className="text-[var(--ff-text-tertiary)]">Project:</span> {jobDetails.project}</p>
                          <p><span className="text-[var(--ff-text-tertiary)]">Created:</span> {formatTimeAgo(jobDetails.createdAt)}</p>
                        </div>
                      </div>
                    )}

                    {/* Project Details */}
                    {projectDetails && (
                      <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded text-sm">
                        <p className="font-medium text-[var(--ff-text-primary)] mb-2">Project Found:</p>
                        <div className="space-y-1 text-[var(--ff-text-secondary)]">
                          <p><span className="text-[var(--ff-text-tertiary)]">ID:</span> {projectDetails.id}</p>
                          <p><span className="text-[var(--ff-text-tertiary)]">Name:</span> {projectDetails.name}</p>
                          <p><span className="text-[var(--ff-text-tertiary)]">Owner:</span> {projectDetails.owner}</p>
                          <p><span className="text-[var(--ff-text-tertiary)]">Total Jobs:</span> {projectDetails.jobCount}</p>
                          {projectDetails.lastJobStatus && (
                            <p><span className="text-[var(--ff-text-tertiary)]">Last Job:</span> <span className={
                              projectDetails.lastJobStatus === 'finished' ? 'text-green-500' :
                              projectDetails.lastJobStatus === 'failed' ? 'text-red-500' : 'text-yellow-500'
                            }>{projectDetails.lastJobStatus}</span></p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Job Timeline Stats */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">📊 Job Timeline (Last 24h)</h2>

                {jobStats ? (
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                    <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                      <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{jobStats.total}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Total Jobs</p>
                    </div>
                    <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                      <p className="text-2xl font-bold text-green-500">{jobStats.success}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Successful</p>
                    </div>
                    <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                      <p className="text-2xl font-bold text-red-500">{jobStats.failed}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Failed</p>
                    </div>
                    <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                      <p className="text-2xl font-bold text-yellow-500">{jobStats.pending + jobStats.queued}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Pending</p>
                    </div>
                    <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                      <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{jobStats.successRate}%</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Success Rate</p>
                    </div>
                    <div className="text-center p-3 bg-[var(--ff-bg-tertiary)] rounded">
                      <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{formatDuration(jobStats.avgDurationSec)}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Avg Duration</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[var(--ff-text-tertiary)]">Loading stats...</p>
                )}
              </div>

              {/* Stuck Jobs List */}
              {serviceStatus && serviceStatus.jobs.stuck.length > 0 && (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">
                    ⚠️ Stuck Jobs ({serviceStatus.jobs.stuck.length})
                  </h2>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[var(--ff-text-tertiary)] border-b border-[var(--ff-border-light)]">
                          <th className="pb-2 pr-4">ID</th>
                          <th className="pb-2 pr-4">Type</th>
                          <th className="pb-2 pr-4">Status</th>
                          <th className="pb-2 pr-4">Project</th>
                          <th className="pb-2">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceStatus.jobs.stuck.map((job) => (
                          <tr key={job.id} className="border-b border-[var(--ff-border-light)] text-[var(--ff-text-secondary)]">
                            <td className="py-2 pr-4 font-mono text-xs">{job.id.substring(0, 8)}...</td>
                            <td className="py-2 pr-4">{job.type}</td>
                            <td className="py-2 pr-4">
                              <span className={`px-2 py-1 rounded text-xs ${
                                job.status === 'pending' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-orange-500/20 text-orange-500'
                              }`}>
                                {job.status}
                              </span>
                            </td>
                            <td className="py-2 pr-4">{job.project}</td>
                            <td className="py-2">{formatTimeAgo(job.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
