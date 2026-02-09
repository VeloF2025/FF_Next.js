/**
 * BOQ Version Comparison Component
 */

import { X, Plus, Minus, Edit3 } from 'lucide-react';
import { VersionComparison } from './BOQHistoryTypes';

interface BOQVersionComparisonProps {
  comparison: VersionComparison;
  onClose: () => void;
}

export default function BOQVersionComparison({
  comparison,
  onClose
}: BOQVersionComparisonProps) {
  const { fromVersion, toVersion, changes } = comparison;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Version Comparison: {fromVersion.version} → {toVersion.version}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center">
                <Plus className="h-5 w-5 text-green-600 mr-2" />
                <span className="text-lg font-medium text-green-900">
                  {changes.added.length} Added
                </span>
              </div>
            </div>
            
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="flex items-center">
                <Minus className="h-5 w-5 text-red-600 mr-2" />
                <span className="text-lg font-medium text-red-900">
                  {changes.removed.length} Removed
                </span>
              </div>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center">
                <Edit3 className="h-5 w-5 text-blue-600 mr-2" />
                <span className="text-lg font-medium text-blue-900">
                  {changes.modified.length} Modified
                </span>
              </div>
            </div>
          </div>

          {/* Added Items */}
          {changes.added.length > 0 && (
            <div className="mb-6">
              <h3 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                <Plus className="h-4 w-4 text-green-600 mr-2" />
                Added Items
              </h3>
              <div className="bg-green-50 rounded-lg p-3">
                <table className="min-w-full divide-y divide-green-200">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-green-800 uppercase">
                        Line #
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-green-800 uppercase">
                        Description
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-green-800 uppercase">
                        Quantity
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-green-200">
                    {changes.added.map(item => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-sm text-green-900">
                          {item.lineNumber}
                        </td>
                        <td className="px-3 py-2 text-sm text-green-900">
                          {item.description}
                        </td>
                        <td className="px-3 py-2 text-sm text-green-900">
                          {item.quantity} {item.uom}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Removed Items */}
          {changes.removed.length > 0 && (
            <div className="mb-6">
              <h3 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                <Minus className="h-4 w-4 text-red-600 mr-2" />
                Removed Items
              </h3>
              <div className="bg-red-50 rounded-lg p-3">
                <table className="min-w-full divide-y divide-red-200">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-red-800 uppercase">
                        Line #
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-red-800 uppercase">
                        Description
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-red-800 uppercase">
                        Quantity
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-200">
                    {changes.removed.map(item => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-sm text-red-900 line-through">
                          {item.lineNumber}
                        </td>
                        <td className="px-3 py-2 text-sm text-red-900 line-through">
                          {item.description}
                        </td>
                        <td className="px-3 py-2 text-sm text-red-900 line-through">
                          {item.quantity} {item.uom}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modified Items */}
          {changes.modified.length > 0 && (
            <div>
              <h3 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                <Edit3 className="h-4 w-4 text-blue-600 mr-2" />
                Modified Items
              </h3>
              <div className="space-y-3">
                {changes.modified.map(({ item, changes: itemChanges }) => (
                  <div key={item.id} className="bg-blue-50 rounded-lg p-3">
                    <div className="font-medium text-blue-900 mb-2">
                      Line {item.lineNumber}: {item.description}
                    </div>
                    <div className="space-y-1">
                      {itemChanges.map((change, idx) => (
                        <div key={idx} className="flex items-center text-sm">
                          <span className="text-blue-700 font-medium w-24">
                            {change.field}:
                          </span>
                          <span className="text-red-700 line-through mr-2">
                            {String(change.oldValue ?? '')}
                          </span>
                          <span className="text-gray-500">→</span>
                          <span className="text-green-700 ml-2">
                            {String(change.newValue ?? '')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}