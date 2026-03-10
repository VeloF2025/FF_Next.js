/**
 * Phase 3: Data Validation
 * Compare VLM-extracted data against QField database values.
 * Allows manual overrides for incorrect extractions.
 */

'use client';

import { CheckCircle, XCircle, Edit3 } from 'lucide-react';
import type { Discipline } from '../../types';

interface Props {
  review: {
    discipline: Discipline;
    feature_id: string;
    extracted_pole_number?: string | null;
    extracted_pole_height?: string | null;
    extracted_cable_type?: string | null;
    extracted_joint_type?: string | null;
    extracted_splice_count?: number | null;
    pole_latitude?: number | null;
    pole_longitude?: number | null;
    pole_material?: string | null;
    pole_height_m?: number | null;
    span_from_pole?: string | null;
    span_to_pole?: string | null;
    span_length_m?: number | null;
    span_cable_size?: string | null;
    joint_cable_cap?: string | null;
    [key: string]: unknown;
  };
  overrides: Record<string, string>;
  onOverride: (field: string, value: string) => void;
}

interface ValidationField {
  label: string;
  extractedField: string;
  referenceField: string;
  extractedValue: string | number | null | undefined;
  referenceValue: string | number | null | undefined;
}

export function PhaseDataValidation({ review, overrides, onOverride }: Props) {
  const fields = getValidationFields(review);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Data Validation</h2>
        <p className="text-sm text-gray-400">
          Compare AI-extracted data with QField records. Override incorrect values if needed.
        </p>
      </div>

      <div className="space-y-3">
        {fields.map((field, i) => {
          const extracted = overrides[field.extractedField] ?? String(field.extractedValue ?? '—');
          const reference = String(field.referenceValue ?? '—');
          const matches = extracted.toLowerCase() === reference.toLowerCase() || (extracted === '—' && reference === '—');
          const hasOverride = field.extractedField in overrides;

          return (
            <div
              key={i}
              className={`grid grid-cols-12 gap-4 items-center p-3 rounded-lg border ${
                matches ? 'border-green-500/20' : 'border-red-500/20'
              }`}
            >
              {/* Label */}
              <div className="col-span-3">
                <span className="text-sm font-medium text-gray-300">{field.label}</span>
              </div>

              {/* AI Extracted */}
              <div className="col-span-3">
                <div className="text-xs text-gray-500 mb-0.5">AI Extracted</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={overrides[field.extractedField] ?? String(field.extractedValue ?? '')}
                    onChange={e => onOverride(field.extractedField, e.target.value)}
                    className="w-full bg-gray-900 border border-[var(--border-color)] rounded px-2 py-1 text-sm text-white"
                    placeholder="—"
                  />
                  {hasOverride && (
                    <Edit3 className="w-3 h-3 text-yellow-400 flex-shrink-0" aria-label="Manually overridden" />
                  )}
                </div>
              </div>

              {/* Reference (QField) */}
              <div className="col-span-3">
                <div className="text-xs text-gray-500 mb-0.5">QField Reference</div>
                <div className="text-sm text-gray-300 px-2 py-1">{reference}</div>
              </div>

              {/* Match Status */}
              <div className="col-span-3 flex items-center gap-2">
                {matches ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-green-400">Match</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span className="text-xs text-red-400">Mismatch</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {fields.every(f => {
        const ext = overrides[f.extractedField] ?? String(f.extractedValue ?? '—');
        const ref = String(f.referenceValue ?? '—');
        return ext.toLowerCase() === ref.toLowerCase() || (ext === '—' && ref === '—');
      }) ? (
        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-sm text-green-400 font-medium">
            All extracted data matches QField records.
          </p>
        </div>
      ) : (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-sm text-yellow-400 font-medium">
            Some fields have mismatches. Review and override if the AI extraction is incorrect.
          </p>
        </div>
      )}
    </div>
  );
}

function getValidationFields(review: Props['review']): ValidationField[] {
  switch (review.discipline) {
    case 'civil':
      return [
        {
          label: 'Pole Number',
          extractedField: 'extracted_pole_number',
          referenceField: 'feature_id',
          extractedValue: review.extracted_pole_number,
          referenceValue: review.feature_id,
        },
        {
          label: 'Pole Height',
          extractedField: 'extracted_pole_height',
          referenceField: 'pole_height_m',
          extractedValue: review.extracted_pole_height,
          referenceValue: review.pole_height_m,
        },
        {
          label: 'Material',
          extractedField: 'pole_material',
          referenceField: 'pole_material',
          extractedValue: review.pole_material,
          referenceValue: review.pole_material,
        },
      ];

    case 'optical':
      // For joint features (dome/main_joint), show joint-specific fields
      if (review.feature_type === 'joint') {
        return [
          {
            label: 'Joint Type',
            extractedField: 'extracted_joint_type',
            referenceField: 'joint_cable_cap',
            extractedValue: review.extracted_joint_type,
            referenceValue: review.joint_cable_cap,
          },
          {
            label: 'Splice Count',
            extractedField: 'extracted_splice_count',
            referenceField: 'extracted_splice_count',
            extractedValue: review.extracted_splice_count,
            referenceValue: review.extracted_splice_count,
          },
        ];
      }
      // For cable_span features, show span-specific fields
      return [
        {
          label: 'Cable Type',
          extractedField: 'extracted_cable_type',
          referenceField: 'span_cable_size',
          extractedValue: review.extracted_cable_type,
          referenceValue: review.span_cable_size,
        },
        {
          label: 'From Pole',
          extractedField: 'span_from_pole',
          referenceField: 'span_from_pole',
          extractedValue: review.span_from_pole,
          referenceValue: review.span_from_pole,
        },
        {
          label: 'To Pole',
          extractedField: 'span_to_pole',
          referenceField: 'span_to_pole',
          extractedValue: review.span_to_pole,
          referenceValue: review.span_to_pole,
        },
        {
          label: 'Span Length (m)',
          extractedField: 'span_length_m',
          referenceField: 'span_length_m',
          extractedValue: review.span_length_m,
          referenceValue: review.span_length_m,
        },
      ];

    default:
      return [];
  }
}
