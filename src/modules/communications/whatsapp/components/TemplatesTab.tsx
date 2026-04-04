/**
 * Templates Tab - WhatsApp Message Template Management
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Eye,
  Edit2,
  Save,
  X,
  CheckCircle,
  XCircle,
  RotateCcw,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaMessageTemplate } from '../types/wa-admin.types';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

const TemplatesTab: React.FC = () => {
  const [templates, setTemplates] = useState<WaMessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WaMessageTemplate | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async (selectFirst = false) => {
    setLoading(true);
    setError(null);

    const result = await waAdminApi.templates.list();

    if (result.success && result.data) {
      setTemplates(result.data);
      if (selectFirst && result.data.length > 0) {
        setSelectedTemplate(result.data[0] ?? null);
      }
    } else {
      setError(result.error || 'Failed to fetch templates');
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates(true); // Select first template on initial load
  }, [fetchTemplates]);

  useEffect(() => {
    if (selectedTemplate) {
      setEditContent(selectedTemplate.template_content);
      setPreview(null);
    }
  }, [selectedTemplate]);

  const handlePreview = async () => {
    if (!selectedTemplate) return;

    // Generate sample data based on variables
    const sampleData: Record<string, string> = {};
    for (const variable of selectedTemplate.variables) {
      sampleData[variable] = getSampleValue(variable);
    }

    const result = await waAdminApi.templates.preview(selectedTemplate.template_key, sampleData);

    if (result.success && result.data) {
      setPreview(result.data.preview);
    } else {
      notificationService.error(result.error || 'Failed to generate preview');
    }
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;

    setSaving(true);

    const result = await waAdminApi.templates.update(selectedTemplate.template_key, {
      template_content: editContent,
    });

    if (result.success && result.data) {
      setSelectedTemplate(result.data);
      setEditMode(false);
      fetchTemplates(false); // Don't re-select first template
      notificationService.success('Template saved successfully');
    } else {
      notificationService.error(result.error || 'Failed to save template');
    }

    setSaving(false);
  };

  const handleReset = () => {
    if (selectedTemplate) {
      setEditContent(selectedTemplate.template_content);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'acknowledgment':
        return 'bg-blue-100 text-blue-800';
      case 'feedback':
        return 'bg-green-100 text-green-800';
      case 'notification':
        return 'bg-yellow-100 text-yellow-800';
      case 'system':
        return 'bg-secondary text-foreground';
      default:
        return 'bg-secondary text-foreground';
    }
  };

  if (loading) {
    return (
      <LoadingSpinner className="py-12" size="lg" label="Loading templates..." />
    );
  }

  if (error && templates.length === 0) {
    return (
      <div className="text-center py-12" role="alert">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => fetchTemplates(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Message Templates
        </h3>
        <button
          onClick={() => fetchTemplates(false)}
          disabled={loading}
          aria-label="Refresh templates"
          className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template List */}
        <div className="lg:col-span-1 border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="bg-[var(--ff-bg-secondary)] px-4 py-3 border-b border-[var(--ff-border-light)]">
            <h4 className="font-medium text-[var(--ff-text-primary)]">Templates</h4>
          </div>
          <div className="divide-y divide-[var(--ff-border-light)] max-h-[500px] overflow-y-auto">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => {
                  setSelectedTemplate(template);
                  setEditMode(false);
                  setPreview(null);
                }}
                aria-pressed={selectedTemplate?.id === template.id}
                aria-label={`Select template: ${template.template_name}`}
                className={`w-full text-left px-4 py-3 hover:bg-[var(--ff-bg-secondary)] transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-green-500 ${
                  selectedTemplate?.id === template.id ? 'bg-green-500/10 border-l-4 border-green-500' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">
                      {template.template_name}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                      {template.template_key}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${getCategoryColor(template.category)}`}>
                    {template.category}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {template.enabled ? (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Enabled
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--ff-text-secondary)] flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Disabled
                    </span>
                  )}
                  {template.is_default && (
                    <span className="text-xs text-blue-600">Default</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Template Editor */}
        <div className="lg:col-span-2 border border-[var(--ff-border-light)] rounded-lg">
          {selectedTemplate ? (
            <>
              {/* Editor Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
                <h4 className="font-medium text-[var(--ff-text-primary)]">
                  {selectedTemplate.template_name}
                </h4>
                <div className="flex items-center gap-2">
                  {editMode ? (
                    <>
                      <button
                        onClick={handleReset}
                        aria-label="Reset template to original content"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                      >
                        <RotateCcw className="w-4 h-4" aria-hidden="true" />
                        Reset
                      </button>
                      <button
                        onClick={() => setEditMode(false)}
                        aria-label="Cancel editing"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        aria-label="Save template changes"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        {saving ? (
                          <InlineSpinner size="sm" />
                        ) : (
                          <Save className="w-4 h-4" aria-hidden="true" />
                        )}
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handlePreview}
                        aria-label="Preview template with sample data"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                      >
                        <Eye className="w-4 h-4" aria-hidden="true" />
                        Preview
                      </button>
                      <button
                        onClick={() => setEditMode(true)}
                        aria-label="Edit template content"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <Edit2 className="w-4 h-4" aria-hidden="true" />
                        Edit
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Variables */}
              <div id="template-variables" className="px-4 py-2 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
                <p className="text-xs text-[var(--ff-text-secondary)]">
                  <strong>Available Variables:</strong>{' '}
                  {selectedTemplate.variables.map((v) => (
                    <code key={v} className="bg-[var(--ff-bg-card)] px-1 py-0.5 rounded mx-1">
                      {'{{' + v + '}}'}
                    </code>
                  ))}
                </p>
              </div>

              {/* Editor/Preview Content */}
              <div className="p-4">
                {editMode ? (
                  <div>
                    <label htmlFor="template-editor" className="sr-only">
                      Template content editor
                    </label>
                    <textarea
                      id="template-editor"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      aria-describedby="template-variables"
                      className="w-full h-[300px] font-mono text-sm p-3 border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Enter template content..."
                    />
                  </div>
                ) : preview ? (
                  <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm whitespace-pre-wrap">
                    {preview}
                  </div>
                ) : (
                  <pre className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] p-4 rounded-lg text-sm whitespace-pre-wrap overflow-x-auto">
                    {selectedTemplate.template_content}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-12 text-[var(--ff-text-secondary)]">
              <FileText className="w-8 h-8 mr-2" />
              Select a template to view or edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Generate sample values for template variables
 */
function getSampleValue(variable: string): string {
  const samples: Record<string, string> = {
    dropNumber: 'DR1752169',
    photoCount: '8',
    ontSerial: 'ALCLB48CC3CA',
    upsSerial: 'GU18W12V2508057584',
    serialsSwapped: '',
    missingSteps: 'Step 7 (Power Meter), Step 10 (Signature)',
    photoCoverage: '8',
    missingPhotos: 'Power Meter, Signature',
    powerMeter: '-21.5',
    ontStatus: 'Valid',
    upsStatus: 'Valid',
    notes: 'Good installation overall. Please ensure power meter reading is captured next time.',
    failReason: 'Missing required photos',
    reworkReason: 'Power meter reading unclear',
    issues: '["Missing power meter photo", "Signature not visible"]',
    timestamp: new Date().toISOString(),
    service: 'FibreFlow QA',
    groupName: 'Lawley DR Photos',
  };

  return samples[variable] || `[${variable}]`;
}

export default TemplatesTab;
