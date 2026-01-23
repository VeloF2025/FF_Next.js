'use client';

/**
 * Category Form Client Component
 * Form for creating new asset categories
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { notificationService } from '@/services/core/NotificationService';
import { Save, Loader2, Info } from 'lucide-react';
import { ASSET_CATEGORY_CONFIG, AssetCategoryType } from '@/modules/assets/constants/assetCategories';

interface FormData {
  name: string;
  code: string;
  type: string;
  description: string;
  requiresCalibration: boolean;
  calibrationIntervalDays: number | '';
  depreciationYears: number | '';
}

const initialFormData: FormData = {
  name: '',
  code: '',
  type: '',
  description: '',
  requiresCalibration: false,
  calibrationIntervalDays: '',
  depreciationYears: '',
};

export function CategoryFormClient() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Get category type options
  const typeOptions = Object.entries(ASSET_CATEGORY_CONFIG).map(([value, config]) => ({
    value,
    label: config.label,
    description: config.description,
    requiresCalibration: config.requiresCalibration,
    defaultCalibrationDays: config.defaultCalibrationDays,
    defaultDepreciationYears: config.defaultDepreciationYears,
  }));

  function handleTypeChange(type: string) {
    const config = ASSET_CATEGORY_CONFIG[type as keyof typeof ASSET_CATEGORY_CONFIG];
    if (config) {
      setFormData((prev) => ({
        ...prev,
        type,
        requiresCalibration: config.requiresCalibration,
        calibrationIntervalDays: config.defaultCalibrationDays || '',
        depreciationYears: config.defaultDepreciationYears,
      }));
    } else {
      setFormData((prev) => ({ ...prev, type }));
    }
  }

  function handleChange(field: keyof FormData, value: string | number | boolean) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when field changes
    if (errors[field]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
  }

  function handleCodeChange(value: string) {
    // Auto-uppercase and remove invalid characters
    const sanitized = value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    handleChange('code', sanitized);
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    } else if (formData.name.length > 100) {
      newErrors.name = 'Name must be 100 characters or less';
    }

    if (!formData.code.trim()) {
      newErrors.code = 'Code is required';
    } else if (formData.code.length > 20) {
      newErrors.code = 'Code must be 20 characters or less';
    } else if (!/^[A-Z0-9_]+$/.test(formData.code)) {
      newErrors.code = 'Code must be uppercase letters, numbers, and underscores only';
    }

    if (!formData.type) {
      newErrors.type = 'Type is required';
    }

    if (formData.description && formData.description.length > 500) {
      newErrors.description = 'Description must be 500 characters or less';
    }

    if (formData.requiresCalibration && !formData.calibrationIntervalDays) {
      newErrors.calibrationIntervalDays = 'Calibration interval is required when calibration is enabled';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validate()) {
      notificationService.error('Please fix the form errors');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        type: formData.type,
        description: formData.description.trim() || undefined,
        requiresCalibration: formData.requiresCalibration,
        calibrationIntervalDays: formData.requiresCalibration && formData.calibrationIntervalDays
          ? Number(formData.calibrationIntervalDays)
          : undefined,
        depreciationYears: formData.depreciationYears ? Number(formData.depreciationYears) : undefined,
      };

      const response = await fetch('/api/assets/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        notificationService.success('Category created successfully');
        router.push('/assets/categories');
      } else {
        notificationService.error(data.error || 'Failed to create category');
        if (data.details) {
          // Map validation errors to form fields
          const fieldErrors: Record<string, string> = {};
          for (const err of data.details) {
            if (err.path?.[0]) {
              fieldErrors[err.path[0]] = err.message;
            }
          }
          setErrors(fieldErrors);
        }
      }
    } catch (error) {
      notificationService.error('Failed to create category');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Category Details</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Category Type */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category Type <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.type}
              onChange={(e) => handleTypeChange(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                errors.type
                  ? 'border-red-500 dark:border-red-400'
                  : 'border-gray-300 dark:border-gray-600'
              } focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent`}
            >
              <option value="">Select a type...</option>
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.type && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.type}</p>
            )}
            {formData.type && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {typeOptions.find((o) => o.value === formData.type)?.description}
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="e.g., EXFO OTDR"
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                errors.name
                  ? 'border-red-500 dark:border-red-400'
                  : 'border-gray-300 dark:border-gray-600'
              } focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent`}
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.name}</p>
            )}
          </div>

          {/* Code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category Code <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="e.g., OTDR"
              maxLength={20}
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono ${
                errors.code
                  ? 'border-red-500 dark:border-red-400'
                  : 'border-gray-300 dark:border-gray-600'
              } focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent`}
            />
            {errors.code ? (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.code}</p>
            ) : (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Uppercase letters, numbers, and underscores only
              </p>
            )}
          </div>

          {/* Description */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={3}
              placeholder="Brief description of this category..."
              className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                errors.description
                  ? 'border-red-500 dark:border-red-400'
                  : 'border-gray-300 dark:border-gray-600'
              } focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent`}
            />
            {errors.description && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Calibration & Depreciation */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Calibration & Depreciation
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Requires Calibration */}
          <div className="md:col-span-2">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.requiresCalibration}
                onChange={(e) => handleChange('requiresCalibration', e.target.checked)}
                className="w-5 h-5 text-blue-600 dark:text-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Requires periodic calibration
              </span>
            </label>
            <p className="mt-1 ml-8 text-sm text-gray-500 dark:text-gray-400">
              Enable for equipment that needs regular calibration (e.g., test equipment)
            </p>
          </div>

          {/* Calibration Interval */}
          {formData.requiresCalibration && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Calibration Interval (days) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={formData.calibrationIntervalDays}
                onChange={(e) =>
                  handleChange('calibrationIntervalDays', e.target.value ? Number(e.target.value) : '')
                }
                min={1}
                placeholder="e.g., 365"
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                  errors.calibrationIntervalDays
                    ? 'border-red-500 dark:border-red-400'
                    : 'border-gray-300 dark:border-gray-600'
                } focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent`}
              />
              {errors.calibrationIntervalDays && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {errors.calibrationIntervalDays}
                </p>
              )}
            </div>
          )}

          {/* Depreciation Years */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Depreciation Period (years)
            </label>
            <input
              type="number"
              value={formData.depreciationYears}
              onChange={(e) =>
                handleChange('depreciationYears', e.target.value ? Number(e.target.value) : '')
              }
              min={1}
              placeholder="e.g., 5"
              className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Used for asset depreciation calculations
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-start space-x-3">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium">Default values</p>
            <p className="mt-1">
              Selecting a category type will automatically set recommended defaults for calibration
              and depreciation based on industry standards.
            </p>
          </div>
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={() => router.push('/assets/categories')}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Create Category
            </>
          )}
        </button>
      </div>
    </form>
  );
}
