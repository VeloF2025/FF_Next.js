/**
 * Quote Extraction Results Component
 *
 * Displays extracted quote data with editing capabilities
 *
 * Status: WORKING - OCR Quote Scanner Feature
 */

import { useState, useMemo } from 'react';
import {
  Building,
  FileText,
  Package,
  DollarSign,
  Edit2,
  Check,
  X,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  QuoteExtractionResult,
  ExtractedLineItem,
  EditableExtractionItem,
} from '../types/extraction.types';

// ============================================================================
// TYPES
// ============================================================================

interface QuoteExtractionResultsProps {
  extraction: QuoteExtractionResult;
  onUpdate?: (updatedExtraction: QuoteExtractionResult) => void;
  readOnly?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function QuoteExtractionResults({
  extraction,
  onUpdate,
  readOnly = false,
}: QuoteExtractionResultsProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editingItemField, setEditingItemField] = useState<string | null>(null);

  // Calculate totals from line items
  const calculatedTotals = useMemo(() => {
    const items = extraction.lineItems || [];
    const subtotal = items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const vatRate = extraction.totals?.vatRate || 15;
    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;
    return { subtotal, vatRate, vatAmount, total };
  }, [extraction.lineItems, extraction.totals?.vatRate]);

  // Start editing a field
  const handleEdit = (field: string, currentValue: string | number | null) => {
    if (readOnly) return;
    setEditingField(field);
    setEditValue(String(currentValue || ''));
  };

  // Save field edit
  const handleSaveField = () => {
    if (!editingField || !onUpdate) return;

    const [section, field] = editingField.split('.');
    const updatedExtraction = { ...extraction };

    if (section === 'supplier') {
      updatedExtraction.supplier = {
        ...extraction.supplier,
        [field]: editValue || null,
      };
    } else if (section === 'quoteInfo') {
      updatedExtraction.quoteInfo = {
        ...extraction.quoteInfo,
        [field]: editValue || null,
      };
    }

    onUpdate(updatedExtraction);
    setEditingField(null);
    setEditValue('');
  };

  // Start editing a line item field
  const handleEditItem = (index: number, field: string, currentValue: string | number | null) => {
    if (readOnly) return;
    setEditingItemIndex(index);
    setEditingItemField(field);
    setEditValue(String(currentValue || ''));
  };

  // Save line item edit
  const handleSaveItem = () => {
    if (editingItemIndex === null || !editingItemField || !onUpdate) return;

    const updatedItems = [...(extraction.lineItems || [])];
    const item = { ...updatedItems[editingItemIndex] };

    // Parse numeric fields
    if (['quantity', 'unitPrice', 'totalPrice'].includes(editingItemField)) {
      Object.assign(item, { [editingItemField]: editValue ? parseFloat(editValue) : null });

      // Recalculate total if quantity or unit price changed
      if (editingItemField === 'quantity' || editingItemField === 'unitPrice') {
        if (item.quantity && item.unitPrice) {
          item.totalPrice = item.quantity * item.unitPrice;
        }
      }
    } else {
      Object.assign(item, { [editingItemField]: editValue || null });
    }

    updatedItems[editingItemIndex] = item;

    onUpdate({
      ...extraction,
      lineItems: updatedItems,
    });

    setEditingItemIndex(null);
    setEditingItemField(null);
    setEditValue('');
  };

  // Cancel editing
  const handleCancel = () => {
    setEditingField(null);
    setEditingItemIndex(null);
    setEditingItemField(null);
    setEditValue('');
  };

  // Get confidence indicator
  const getConfidenceIndicator = (confidence: number) => {
    if (confidence >= 0.8) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    } else if (confidence >= 0.5) {
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
    return <AlertTriangle className="h-4 w-4 text-red-500" />;
  };

  return (
    <div className="space-y-6">
      {/* Supplier Info */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <Building className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Supplier Information</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditableField
            label="Company Name"
            value={extraction.supplier?.name}
            field="supplier.name"
            isEditing={editingField === 'supplier.name'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
          />
          <EditableField
            label="Email"
            value={extraction.supplier?.email}
            field="supplier.email"
            isEditing={editingField === 'supplier.email'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
          />
          <EditableField
            label="Phone"
            value={extraction.supplier?.phone}
            field="supplier.phone"
            isEditing={editingField === 'supplier.phone'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
          />
          <EditableField
            label="VAT Number"
            value={extraction.supplier?.vatNumber}
            field="supplier.vatNumber"
            isEditing={editingField === 'supplier.vatNumber'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* Quote Info */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Quote Details</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <EditableField
            label="Quote Number"
            value={extraction.quoteInfo?.quoteNumber}
            field="quoteInfo.quoteNumber"
            isEditing={editingField === 'quoteInfo.quoteNumber'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
          />
          <EditableField
            label="Quote Date"
            value={extraction.quoteInfo?.quoteDate}
            field="quoteInfo.quoteDate"
            isEditing={editingField === 'quoteInfo.quoteDate'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
            type="date"
          />
          <EditableField
            label="Valid Until"
            value={extraction.quoteInfo?.validUntil}
            field="quoteInfo.validUntil"
            isEditing={editingField === 'quoteInfo.validUntil'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
            type="date"
          />
          <EditableField
            label="Payment Terms"
            value={extraction.quoteInfo?.paymentTerms}
            field="quoteInfo.paymentTerms"
            isEditing={editingField === 'quoteInfo.paymentTerms'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
          />
          <EditableField
            label="Delivery Terms"
            value={extraction.quoteInfo?.deliveryTerms}
            field="quoteInfo.deliveryTerms"
            isEditing={editingField === 'quoteInfo.deliveryTerms'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
          />
          <EditableField
            label="Delivery Days"
            value={extraction.quoteInfo?.deliveryDays}
            field="quoteInfo.deliveryDays"
            isEditing={editingField === 'quoteInfo.deliveryDays'}
            editValue={editValue}
            onEdit={handleEdit}
            onSave={handleSaveField}
            onCancel={handleCancel}
            onChange={setEditValue}
            readOnly={readOnly}
            type="number"
          />
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <Package className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">
            Line Items ({extraction.lineItems?.length || 0})
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">#</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Code</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Description</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Qty</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Unit</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Unit Price</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Total</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {(extraction.lineItems || []).map((item, index) => (
                <tr
                  key={index}
                  className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-accent/30"
                >
                  <td className="py-2 px-2 text-muted-foreground">
                    {item.lineNumber}
                  </td>
                  <td className="py-2 px-2">
                    <EditableCell
                      value={item.itemCode}
                      isEditing={editingItemIndex === index && editingItemField === 'itemCode'}
                      editValue={editValue}
                      onEdit={() => handleEditItem(index, 'itemCode', item.itemCode)}
                      onSave={handleSaveItem}
                      onCancel={handleCancel}
                      onChange={setEditValue}
                      readOnly={readOnly}
                    />
                  </td>
                  <td className="py-2 px-2 max-w-xs">
                    <EditableCell
                      value={item.description}
                      isEditing={editingItemIndex === index && editingItemField === 'description'}
                      editValue={editValue}
                      onEdit={() => handleEditItem(index, 'description', item.description)}
                      onSave={handleSaveItem}
                      onCancel={handleCancel}
                      onChange={setEditValue}
                      readOnly={readOnly}
                      className="truncate"
                    />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <EditableCell
                      value={item.quantity}
                      isEditing={editingItemIndex === index && editingItemField === 'quantity'}
                      editValue={editValue}
                      onEdit={() => handleEditItem(index, 'quantity', item.quantity)}
                      onSave={handleSaveItem}
                      onCancel={handleCancel}
                      onChange={setEditValue}
                      readOnly={readOnly}
                      type="number"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <EditableCell
                      value={item.unit}
                      isEditing={editingItemIndex === index && editingItemField === 'unit'}
                      editValue={editValue}
                      onEdit={() => handleEditItem(index, 'unit', item.unit)}
                      onSave={handleSaveItem}
                      onCancel={handleCancel}
                      onChange={setEditValue}
                      readOnly={readOnly}
                    />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <EditableCell
                      value={item.unitPrice}
                      isEditing={editingItemIndex === index && editingItemField === 'unitPrice'}
                      editValue={editValue}
                      onEdit={() => handleEditItem(index, 'unitPrice', item.unitPrice)}
                      onSave={handleSaveItem}
                      onCancel={handleCancel}
                      onChange={setEditValue}
                      readOnly={readOnly}
                      type="number"
                      format="currency"
                    />
                  </td>
                  <td className="py-2 px-2 text-right font-medium text-foreground">
                    R {(item.totalPrice || 0).toLocaleString()}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {getConfidenceIndicator(item.confidence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Totals</h3>
        </div>

        <div className="flex flex-col items-end space-y-2 text-sm">
          <div className="flex justify-between w-48">
            <span className="text-muted-foreground">Subtotal:</span>
            <span className="text-foreground">
              R {calculatedTotals.subtotal.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between w-48">
            <span className="text-muted-foreground">
              VAT ({calculatedTotals.vatRate}%):
            </span>
            <span className="text-foreground">
              R {calculatedTotals.vatAmount.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between w-48 pt-2 border-t border-border">
            <span className="font-semibold text-foreground">Total:</span>
            <span className="font-semibold text-foreground">
              R {calculatedTotals.total.toLocaleString()}
            </span>
          </div>

          {extraction.totals?.total && Math.abs(extraction.totals.total - calculatedTotals.total) > 1 && (
            <div className="flex items-center gap-2 mt-2 text-xs text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4" />
              <span>Extracted total (R {extraction.totals.total.toLocaleString()}) differs from calculated</span>
            </div>
          )}
        </div>
      </div>

      {/* Extraction Notes */}
      {extraction.extractionNotes && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            <strong>Notes:</strong> {extraction.extractionNotes}
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EDITABLE FIELD COMPONENT
// ============================================================================

interface EditableFieldProps {
  label: string;
  value: string | number | null | undefined;
  field: string;
  isEditing: boolean;
  editValue: string;
  onEdit: (field: string, value: string | number | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  readOnly?: boolean;
  type?: 'text' | 'date' | 'number';
}

function EditableField({
  label,
  value,
  field,
  isEditing,
  editValue,
  onEdit,
  onSave,
  onCancel,
  onChange,
  readOnly,
  type = 'text',
}: EditableFieldProps) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      {isEditing ? (
        <div className="flex items-center gap-1 mt-1">
          <input
            type={type}
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
              if (e.key === 'Escape') onCancel();
            }}
          />
          <Button variant="ghost" size="icon" onClick={onSave} aria-label="Save"><Check className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel"><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 mt-1 group">
          <p className="text-sm font-medium text-foreground">
            {value || <span className="text-gray-400 italic">Not extracted</span>}
          </p>
          {!readOnly && (
            <Button variant="ghost" size="icon" onClick={() => onEdit(field, value ?? null)} aria-label="Edit" className="opacity-0 group-hover:opacity-100 transition-opacity"><Edit2 className="h-3 w-3" /></Button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EDITABLE CELL COMPONENT
// ============================================================================

interface EditableCellProps {
  value: string | number | null | undefined;
  isEditing: boolean;
  editValue: string;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  readOnly?: boolean;
  type?: 'text' | 'number';
  format?: 'currency';
  className?: string;
}

function EditableCell({
  value,
  isEditing,
  editValue,
  onEdit,
  onSave,
  onCancel,
  onChange,
  readOnly,
  type = 'text',
  format,
  className = '',
}: EditableCellProps) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type={type}
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-1 py-0.5 text-sm border border-blue-500 rounded focus:outline-none dark:bg-gray-700 dark:text-white"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <Button variant="ghost" size="icon" onClick={onSave} aria-label="Save"><Check className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel"><X className="h-3 w-3" /></Button>
      </div>
    );
  }

  let displayValue = value;
  if (format === 'currency' && typeof value === 'number') {
    displayValue = `R ${value.toLocaleString()}`;
  }

  return (
    <span
      className={`
        text-foreground cursor-pointer hover:text-blue-600
        ${!readOnly ? 'hover:underline' : ''}
        ${className}
      `}
      onClick={!readOnly ? onEdit : undefined}
    >
      {displayValue ?? <span className="text-gray-400">-</span>}
    </span>
  );
}

export default QuoteExtractionResults;
