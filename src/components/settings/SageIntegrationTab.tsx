/**
 * Sage Integration Settings Tab
 *
 * Allows configuring Sage Business Cloud Accounting integration:
 * - Enter API credentials (Client ID, Client Secret, Company ID)
 * - Initiate OAuth authorization
 * - Test connection
 * - View sync status
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  Check,
  X,
  RefreshCw,
  ExternalLink,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2
} from 'lucide-react';

interface SageConfig {
  clientId: string;
  clientSecretMasked: string;
  companyId: string;
  baseUrl: string;
  redirectUri: string;
  isConnected: boolean;
  lastConnectionTestAt: string | null;
  lastSyncAt: string | null;
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
  companyId?: string;
  testedAt: string;
  needsAuthorization?: boolean;
  authorizationUrl?: string;
}

export function SageIntegrationTab() {
  const [config, setConfig] = useState<SageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    clientId: '',
    clientSecret: '',
    companyId: '',
    baseUrl: 'https://accounting.sageone.co.za',
    redirectUri: typeof window !== 'undefined'
      ? `${window.location.origin}/api/sage/oauth/callback`
      : '',
  });

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/sage/config');
      const data = await response.json();

      if (data.success && data.data.configured) {
        setConfig(data.data.config);
        setFormData(prev => ({
          ...prev,
          clientId: data.data.config.clientId || '',
          companyId: data.data.config.companyId || '',
          baseUrl: data.data.config.baseUrl || 'https://accounting.sageone.co.za',
          redirectUri: data.data.config.redirectUri || prev.redirectUri,
        }));
      }
    } catch (err) {
      setError('Failed to load Sage configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/sage/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: formData.clientId,
          clientSecret: formData.clientSecret || undefined,
          companyId: formData.companyId,
          baseUrl: formData.baseUrl,
          redirectUri: formData.redirectUri,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to save configuration');
      }

      // Refresh config
      await fetchConfig();
      setFormData(prev => ({ ...prev, clientSecret: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setError(null);

      const response = await fetch('/api/sage/config/test', {
        method: 'POST',
      });

      const data = await response.json();
      setTestResult(data.data || data);

      if (data.data?.needsAuthorization || data.needsAuthorization) {
        // Need to authorize with Sage
      }
    } catch (err) {
      setError('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleAuthorize = () => {
    // Redirect to Sage OAuth
    window.location.href = '/api/sage/oauth/authorize';
  };

  if (loading) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-text-tertiary)]" />
          <span className="ml-2 text-[var(--ff-text-secondary)]">Loading Sage configuration...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Cloud className="w-6 h-6 text-[var(--ff-accent)] mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Sage Business Cloud Accounting
              </h3>
              <p className="text-sm text-[var(--ff-text-tertiary)]">
                South Africa - Sync invoices, payments, and suppliers
              </p>
            </div>
          </div>
          <div className="flex items-center">
            {config?.isConnected ? (
              <span className="flex items-center text-green-500 text-sm">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Connected
              </span>
            ) : config ? (
              <span className="flex items-center text-yellow-500 text-sm">
                <AlertCircle className="w-4 h-4 mr-1" />
                Not Authorized
              </span>
            ) : (
              <span className="flex items-center text-[var(--ff-text-tertiary)] text-sm">
                <X className="w-4 h-4 mr-1" />
                Not Configured
              </span>
            )}
          </div>
        </div>

        {/* Connection Status */}
        {config && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--ff-bg-tertiary)] rounded-lg text-sm">
            <div>
              <span className="text-[var(--ff-text-tertiary)]">Last Connection Test:</span>
              <span className="ml-2 text-[var(--ff-text-secondary)]">
                {config.lastConnectionTestAt
                  ? new Date(config.lastConnectionTestAt).toLocaleString()
                  : 'Never'}
              </span>
            </div>
            <div>
              <span className="text-[var(--ff-text-tertiary)]">Last Sync:</span>
              <span className="ml-2 text-[var(--ff-text-secondary)]">
                {config.lastSyncAt
                  ? new Date(config.lastSyncAt).toLocaleString()
                  : 'Never'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center">
          <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div className={`rounded-lg p-4 flex items-start ${
          testResult.success
            ? 'bg-green-500/10 border border-green-500/30'
            : testResult.needsAuthorization
              ? 'bg-yellow-500/10 border border-yellow-500/30'
              : 'bg-red-500/10 border border-red-500/30'
        }`}>
          {testResult.success ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 mr-2 mt-0.5" />
          ) : testResult.needsAuthorization ? (
            <AlertCircle className="w-5 h-5 text-yellow-500 mr-2 mt-0.5" />
          ) : (
            <X className="w-5 h-5 text-red-500 mr-2 mt-0.5" />
          )}
          <div>
            <p className={testResult.success ? 'text-green-400' : testResult.needsAuthorization ? 'text-yellow-400' : 'text-red-400'}>
              {testResult.message}
            </p>
            {testResult.needsAuthorization && (
              <button
                onClick={handleAuthorize}
                className="mt-2 bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Authorize with Sage
              </button>
            )}
          </div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <h4 className="text-md font-semibold text-[var(--ff-text-primary)] mb-4">
          API Credentials
        </h4>

        <div className="space-y-4">
          {/* Client ID */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Client ID
            </label>
            <input
              type="text"
              value={formData.clientId}
              onChange={(e) => setFormData(prev => ({ ...prev, clientId: e.target.value }))}
              placeholder="Enter your Sage Client ID"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
          </div>

          {/* Client Secret */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Client Secret
              {config?.clientSecretMasked && (
                <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">
                  (Currently set: {config.clientSecretMasked})
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={formData.clientSecret}
                onChange={(e) => setFormData(prev => ({ ...prev, clientSecret: e.target.value }))}
                placeholder={config?.clientSecretMasked ? 'Leave blank to keep current' : 'Enter your Sage Client Secret'}
                className="w-full px-3 py-2 pr-10 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Company ID */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Company ID
            </label>
            <input
              type="text"
              value={formData.companyId}
              onChange={(e) => setFormData(prev => ({ ...prev, companyId: e.target.value }))}
              placeholder="Enter your Sage Company ID"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              API Base URL
            </label>
            <input
              type="text"
              value={formData.baseUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://accounting.sageone.co.za"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
          </div>

          {/* Redirect URI (read-only) */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Redirect URI <span className="text-xs text-[var(--ff-text-tertiary)]">(for Sage developer portal)</span>
            </label>
            <input
              type="text"
              value={formData.redirectUri}
              readOnly
              className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-tertiary)] cursor-not-allowed"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--ff-border)]">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleSave}
              disabled={saving || !formData.clientId || !formData.companyId}
              className="bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] disabled:bg-[var(--ff-bg-tertiary)] disabled:text-[var(--ff-text-tertiary)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Save Credentials
                </>
              )}
            </button>

            <button
              onClick={handleTestConnection}
              disabled={testing || !config}
              className="bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-border)] disabled:opacity-50 text-[var(--ff-text-primary)] px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Test Connection
                </>
              )}
            </button>
          </div>

          {config && !config.isConnected && (
            <button
              onClick={handleAuthorize}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Authorize with Sage
            </button>
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <h4 className="text-md font-semibold text-[var(--ff-text-primary)] mb-3">
          Setup Instructions
        </h4>
        <ol className="list-decimal list-inside space-y-2 text-sm text-[var(--ff-text-secondary)]">
          <li>Register at the <a href="https://developer.sage.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--ff-accent)] hover:underline">Sage Developer Portal</a></li>
          <li>Create a new application for Sage Business Cloud Accounting (South Africa)</li>
          <li>Copy your Client ID and Client Secret</li>
          <li>Set the Redirect URI in Sage to: <code className="bg-[var(--ff-bg-tertiary)] px-2 py-0.5 rounded text-xs">{formData.redirectUri}</code></li>
          <li>Enter your credentials above and click &quot;Save Credentials&quot;</li>
          <li>Click &quot;Authorize with Sage&quot; to complete the OAuth flow</li>
        </ol>
      </div>
    </div>
  );
}
