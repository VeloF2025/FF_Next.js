/**
 * Sage Integration Settings Tab
 *
 * Allows configuring Sage Business Cloud Accounting integration:
 * - Enter API credentials (API Key, Username, Password, Company ID)
 * - Test connection using Basic Auth
 * - View sync status
 *
 * South African Sage API uses Basic Auth + API Key:
 * - API Key as query parameter: ?apikey=xxx
 * - Basic Auth header: Authorization: Basic base64(username:password)
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
  User,
  Lock
} from 'lucide-react';

interface SageConfig {
  client_id: string;
  client_secret_masked: string;
  company_id: string;
  base_url: string;
  redirect_uri: string;
  is_connected: boolean;
  last_connection_test_at: string | null;
  last_sync_at: string | null;
  auth_type: 'oauth' | 'basic';
  username: string | null;
  password_masked: string | null;
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
  companyId?: string;
  testedAt: string;
  authType?: string;
  needsCredentials?: boolean;
}

export function SageIntegrationTab() {
  const [config, setConfig] = useState<SageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    clientId: '',      // API Key
    companyId: '',
    username: '',      // Sage account email
    password: '',      // Sage account password
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
          clientId: data.data.config.client_id || '',
          companyId: data.data.config.company_id || '',
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
    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/sage/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: formData.clientId,
          company_id: formData.companyId,
          username: formData.username || undefined,
          password: formData.password || undefined,
          base_url: formData.baseUrl,
          auth_type: 'basic',
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to save configuration');
      }

      // Refresh config
      await fetchConfig();
      setFormData(prev => ({ ...prev, password: '' }));
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
            ) : config ? (
              <span className="flex items-center text-yellow-500 text-sm">
                <AlertCircle className="w-4 h-4 mr-1" />
                Not Connected
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
            : testResult.needsCredentials
              ? 'bg-yellow-500/10 border border-yellow-500/30'
              : 'bg-red-500/10 border border-red-500/30'
        }`}>
          {testResult.success ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 mr-2 mt-0.5" />
          ) : testResult.needsCredentials ? (
            <AlertCircle className="w-5 h-5 text-yellow-500 mr-2 mt-0.5" />
          ) : (
            <X className="w-5 h-5 text-red-500 mr-2 mt-0.5" />
          )}
          <div>
            <p className={testResult.success ? 'text-green-400' : testResult.needsCredentials ? 'text-yellow-400' : 'text-red-400'}>
              {testResult.message}
            </p>
            {testResult.companyId && (
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Company ID: {testResult.companyId}
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
          {/* API Key (Client ID) */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              <Key className="w-4 h-4 inline mr-1" />
              API Key
            </label>
            <input
              type="text"
              value={formData.clientId}
              onChange={(e) => setFormData(prev => ({ ...prev, clientId: e.target.value }))}
              placeholder="Enter your Sage API Key"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              From Sage Developer Portal - used as query parameter
            </p>
          </div>

          {/* Company ID */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Company ID (GUID)
            </label>
            <input
              type="text"
              value={formData.companyId}
              onChange={(e) => setFormData(prev => ({ ...prev, companyId: e.target.value }))}
              placeholder="e.g., e2991403-d705-4013-b76d-6f45a75b133a"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--ff-border)] pt-4 mt-4">
            <p className="text-sm text-[var(--ff-text-tertiary)] mb-4">
              Basic Authentication - Your Sage account credentials
            </p>
          </div>

          {/* Username (Email) */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              <User className="w-4 h-4 inline mr-1" />
              Username (Email)
              {config?.username && (
                <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">
                  (Current: {config.username})
                </span>
              )}
            </label>
            <input
              type="email"
              value={formData.username}
              onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
              placeholder="Enter your Sage account email"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
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
                placeholder={config?.password_masked ? 'Leave blank to keep current' : 'Enter your Sage account password'}
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
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border)]">
        <h4 className="text-md font-semibold text-[var(--ff-text-primary)] mb-3">
          Setup Instructions (South Africa)
        </h4>
        <ol className="list-decimal list-inside space-y-2 text-sm text-[var(--ff-text-secondary)]">
          <li>Register at the <a href="https://developer.sage.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--ff-accent)] hover:underline">Sage Developer Portal</a></li>
          <li>Create a new application for Sage Business Cloud Accounting (South Africa)</li>
          <li>Copy your <strong>API Key</strong> from the developer portal</li>
          <li>Get your <strong>Company ID</strong> (GUID) from Sage Settings → Company Details</li>
          <li>Enter your Sage account <strong>email and password</strong> for Basic Authentication</li>
          <li>Click &quot;Save Credentials&quot; then &quot;Test Connection&quot;</li>
        </ol>

        <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm text-blue-400">
            <strong>Note:</strong> South African Sage API uses Basic Authentication (username/password)
            combined with an API key, not OAuth 2.0.
          </p>
        </div>
      </div>
    </div>
  );
}
