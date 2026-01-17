/**
 * Sage Integration Settings Tab
 *
 * Allows configuring Sage Business Cloud Accounting integration:
 * - Enter Basic Auth credentials (API Key, Username, Password)
 * - Test connection
 * - View sync status
 *
 * South African Sage API v2.0.0 uses Basic Auth:
 * - API Key from Sage
 * - Username (Sage login email)
 * - Password (Sage login password)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  Check,
  X,
  RefreshCw,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Key,
  ExternalLink,
  User,
  Lock
} from 'lucide-react';

interface SageConfig {
  api_key_masked: string | null;
  username: string | null;
  password_masked: string | null;
  company_id: string | null;
  base_url: string;
  api_version: string;
  is_connected: boolean;
  last_connection_test_at: string | null;
  last_sync_at: string | null;
  auth_type: string;
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
  companyName?: string;
  testedAt: string;
  authType?: string;
}

export function SageIntegrationTab() {
  const [config, setConfig] = useState<SageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    apiKey: '',
    username: '',
    password: '',
    baseUrl: 'https://accounting.sageone.co.za',
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
          username: data.data.config.username || '',
          baseUrl: data.data.config.base_url || 'https://accounting.sageone.co.za',
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
    if (!formData.username) {
      setError('Username is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const response = await fetch('/api/sage/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: formData.apiKey || undefined,
          username: formData.username,
          password: formData.password || undefined,
          base_url: formData.baseUrl,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to save configuration');
      }

      // Refresh config
      await fetchConfig();
      setFormData(prev => ({ ...prev, apiKey: '', password: '' }));
      setSuccessMessage('Credentials saved successfully');
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
      setSuccessMessage(null);

      const response = await fetch('/api/sage/config/test', {
        method: 'POST',
      });

      const data = await response.json();
      setTestResult(data.data || data);

      // Refresh config to get updated connection status
      await fetchConfig();
    } catch (err) {
      setError('Connection test failed');
    } finally {
      setTesting(false);
    }
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
            {config?.is_connected ? (
              <span className="flex items-center text-green-500 text-sm">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Connected
              </span>
            ) : config?.username ? (
              <span className="flex items-center text-yellow-500 text-sm">
                <AlertCircle className="w-4 h-4 mr-1" />
                Not Tested
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
                {config.last_connection_test_at
                  ? new Date(config.last_connection_test_at).toLocaleString()
                  : 'Never'}
              </span>
            </div>
            <div>
              <span className="text-[var(--ff-text-tertiary)]">Last Sync:</span>
              <span className="ml-2 text-[var(--ff-text-secondary)]">
                {config.last_sync_at
                  ? new Date(config.last_sync_at).toLocaleString()
                  : 'Never'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center">
          <CheckCircle2 className="w-5 h-5 text-green-500 mr-2" />
          <span className="text-green-400">{successMessage}</span>
        </div>
      )}

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
            : 'bg-red-500/10 border border-red-500/30'
        }`}>
          {testResult.success ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 mr-2 mt-0.5" />
          ) : (
            <X className="w-5 h-5 text-red-500 mr-2 mt-0.5" />
          )}
          <div>
            <p className={testResult.success ? 'text-green-400' : 'text-red-400'}>
              {testResult.message}
            </p>
            {testResult.companyName && (
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Company: {testResult.companyName}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <h4 className="text-md font-semibold text-[var(--ff-text-primary)] mb-4">
          API Credentials (Basic Auth)
        </h4>

        <div className="space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              <Key className="w-4 h-4 inline mr-1" />
              API Key
              {config?.api_key_masked && (
                <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">
                  (Currently set: {config.api_key_masked})
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={formData.apiKey}
                onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder={config?.api_key_masked ? 'Leave blank to keep current' : 'Enter your Sage API Key'}
                className="w-full px-3 py-2 pr-10 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              From Sage Settings → Integrations → Developer API
            </p>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              <User className="w-4 h-4 inline mr-1" />
              Username (Email)
            </label>
            <input
              type="email"
              value={formData.username}
              onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
              placeholder="your-email@company.com"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Your Sage Business Cloud login email
            </p>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              <Lock className="w-4 h-4 inline mr-1" />
              Password
              {config?.password_masked && (
                <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">
                  (Currently set: {config.password_masked})
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                placeholder={config?.password_masked ? 'Leave blank to keep current' : 'Enter your Sage password'}
                className="w-full px-3 py-2 pr-10 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Your Sage Business Cloud login password
            </p>
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
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Default: https://accounting.sageone.co.za (South Africa)
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--ff-border)]">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleSave}
              disabled={saving || !formData.username}
              className="bg-[var(--ff-accent)] hover:bg-[var(--ff-accent-hover)] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
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
              disabled={testing || !config?.api_key_masked}
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
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <h4 className="text-md font-semibold text-[var(--ff-text-primary)] mb-3">
          Setup Instructions (South Africa)
        </h4>
        <ol className="list-decimal list-inside space-y-2 text-sm text-[var(--ff-text-secondary)]">
          <li>
            Log into your{' '}
            <a
              href="https://accounting.sageone.co.za"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--ff-accent)] hover:underline inline-flex items-center"
            >
              Sage Business Cloud Accounting
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </li>
          <li>Go to <strong>Settings → Integrations → Developer API</strong></li>
          <li>Generate or copy your <strong>API Key</strong></li>
          <li>Enter your Sage login <strong>email</strong> as Username</li>
          <li>Enter your Sage login <strong>password</strong></li>
          <li>Click &quot;Save Credentials&quot; then &quot;Test Connection&quot;</li>
        </ol>

        <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm text-blue-400">
            <strong>Note:</strong> South African Sage API v2.0.0 uses Basic Authentication
            (not OAuth 2.0). Your credentials are securely stored and transmitted over HTTPS.
          </p>
        </div>
      </div>
    </div>
  );
}
