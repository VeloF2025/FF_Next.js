/**
 * BOQ Column Mapping Review Component
 * Shows detected column mappings with dropdown overrides and sample data preview.
 */

import { useState, useMemo } from 'react';
import type { ColumnMapping, ColumnDetectionResult } from '@/types/procurement/boq.types';

interface BOQColumnMapperProps {
  detection: ColumnDetectionResult;
  onConfirm: (
    mapping: ColumnMapping[],
    saveTemplate?: { name: string; supplierName?: string }
  ) => void;
  onCancel: () => void;
  isImporting?: boolean;
}

const TARGET_FIELDS = [
  { value: 'itemNo', label: 'Item Number' },
  { value: 'uom', label: 'Unit of Measure' },
  { value: 'itemCategory', label: 'Category' },
  { value: 'description', label: 'Description' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'itemCode', label: 'Item Code' },
  { value: 'itemRate', label: 'Unit Rate' },
  { value: 'photonicsRef', label: 'Reference' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'leadTime', label: 'Lead Time' },
  { value: 'totalCost', label: 'Total Cost' },
];

export default function BOQColumnMapper({
  detection,
  onConfirm,
  onCancel,
  isImporting = false,
}: BOQColumnMapperProps) {
  const [mapping, setMapping] = useState<ColumnMapping[]>(detection.mapping);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [supplierName, setSupplierName] = useState('');

  const usedFields = useMemo(() => {
    return new Set(
      mapping.filter(m => m.targetField !== null).map(m => m.targetField)
    );
  }, [mapping]);

  const mappedCount = mapping.filter(m => m.targetField !== null).length;

  const handleFieldChange = (sourceIndex: number, newTargetField: string | null) => {
    setMapping(prev =>
      prev.map(m =>
        m.sourceIndex === sourceIndex
          ? {
              ...m,
              targetField: newTargetField as ColumnMapping['targetField'],
              confidence: newTargetField === null ? 0 : m.confidence,
              detectionMethod: 'manual' as const,
            }
          : m
      )
    );
  };

  const getConfidenceBadge = (confidence: number, targetField: string | null) => {
    if (targetField === null) return { text: '-', color: '#666' };
    if (confidence >= 0.8) return { text: `${Math.round(confidence * 100)}%`, color: '#22c55e' };
    if (confidence >= 0.5) return { text: `${Math.round(confidence * 100)}%`, color: '#eab308' };
    return { text: `${Math.round(confidence * 100)}%`, color: '#ef4444' };
  };

  const getSampleData = (sourceIndex: number): string => {
    const samples = detection.sampleRows
      .slice(0, 3)
      .map(row => {
        const value = row[sourceIndex];
        if (value === null || value === undefined) return '';
        return String(value);
      })
      .filter(v => v.length > 0);

    if (samples.length === 0) return '(empty)';
    return samples.join(' | ').substring(0, 60);
  };

  const handleConfirm = () => {
    const templateData =
      saveAsTemplate && templateName.trim()
        ? { name: templateName.trim(), supplierName: supplierName.trim() || undefined }
        : undefined;
    onConfirm(mapping, templateData);
  };

  const isFieldDisabled = (fieldValue: string, currentSourceIndex: number): boolean => {
    if (!fieldValue) return false;
    const currentMapping = mapping.find(m => m.sourceIndex === currentSourceIndex);
    if (currentMapping?.targetField === fieldValue) return false;
    return usedFields.has(fieldValue);
  };

  return (
    <div style={{ border: '1px solid var(--ff-border-light)', borderRadius: 8, padding: 20, background: 'var(--ff-bg-secondary)' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: 'var(--ff-text-primary)' }}>
          Column Mapping Review
        </h3>
        <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--ff-text-secondary)', flexWrap: 'wrap' }}>
          <span>Sheet: <strong>&quot;{detection.sheetName}&quot;</strong></span>
          <span>Header Row: <strong>{detection.headerRow + 1}</strong></span>
          <span>Mapped: <strong>{mappedCount}/{mapping.length}</strong></span>
          {detection.templateMatch && (
            <span style={{ color: '#22c55e' }}>
              Template: &quot;{detection.templateMatch.name}&quot;
              {detection.templateMatch.supplierName && ` (${detection.templateMatch.supplierName})`}
            </span>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <span style={{ color: detection.overallConfidence >= 0.8 ? '#22c55e' : detection.overallConfidence >= 0.5 ? '#eab308' : '#ef4444' }}>
            Overall Confidence: {Math.round(detection.overallConfidence * 100)}%
          </span>
        </div>
      </div>

      {/* Mapping Table */}
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--ff-border-light)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Source Header</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Map To</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, width: 60 }}>Conf</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Sample Data</th>
            </tr>
          </thead>
          <tbody>
            {mapping.map(m => {
              const badge = getConfidenceBadge(m.confidence, m.targetField);
              return (
                <tr key={m.sourceIndex} style={{ borderBottom: '1px solid var(--ff-border-light)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{m.sourceHeader}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <select
                      value={m.targetField || ''}
                      onChange={e =>
                        handleFieldChange(
                          m.sourceIndex,
                          e.target.value === '' ? null : e.target.value
                        )
                      }
                      disabled={isImporting}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: '1px solid var(--ff-border-light)',
                        fontSize: 13,
                        background: 'var(--ff-bg-tertiary)',
                        color: 'var(--ff-text-primary)',
                        colorScheme: 'dark light',
                        width: '100%',
                        maxWidth: 180,
                      }}
                    >
                      <option value="">— Skip —</option>
                      {TARGET_FIELDS.map(field => (
                        <option
                          key={field.value}
                          value={field.value}
                          disabled={isFieldDisabled(field.value, m.sourceIndex)}
                        >
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <span style={{ color: badge.color, fontWeight: 500, fontSize: 12 }}>
                      {badge.text}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--ff-text-secondary)', fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {getSampleData(m.sourceIndex)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Save as Template */}
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--ff-bg-tertiary)', borderRadius: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={e => setSaveAsTemplate(e.target.checked)}
            disabled={isImporting}
          />
          <span>Save mapping as reusable template</span>
        </label>
        {saveAsTemplate && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="text"
              placeholder="Template name (required)"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              disabled={isImporting}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid var(--ff-border-light)',
                fontSize: 13,
                background: 'var(--ff-bg-tertiary)',
                color: 'var(--ff-text-primary)',
              }}
            />
            <input
              type="text"
              placeholder="Supplier (optional)"
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              disabled={isImporting}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid var(--ff-border-light)',
                fontSize: 13,
                background: 'var(--ff-bg-tertiary)',
                color: 'var(--ff-text-primary)',
              }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={isImporting}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--ff-border-light)',
            background: 'var(--ff-bg-secondary)',
            color: 'var(--ff-text-secondary)',
            fontSize: 13,
            cursor: isImporting ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isImporting || mappedCount === 0 || (saveAsTemplate && !templateName.trim())}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: isImporting || mappedCount === 0 ? '#93c5fd' : '#2563eb',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            cursor: isImporting || mappedCount === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {isImporting ? 'Importing...' : `Confirm & Import (${mappedCount} fields)`}
        </button>
      </div>
    </div>
  );
}
