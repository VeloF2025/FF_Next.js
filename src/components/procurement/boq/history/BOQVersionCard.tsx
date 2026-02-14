/**
 * BOQ Version Card Component
 */

import {
  GitBranch,
  Clock,
  User,
  FileText,
  Eye,
  RotateCcw,
  Download,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { BOQVersion, CHANGE_TYPE_COLORS, CHANGE_TYPE_LABELS } from './BOQHistoryTypes';

interface BOQVersionCardProps {
  version: BOQVersion;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onView?: () => void;
  onRestore?: () => void;
  onExport?: () => void;
}

export default function BOQVersionCard({
  version,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelect,
  onView,
  onRestore,
  onExport
}: BOQVersionCardProps) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border ${isSelected ? 'border-blue-500 shadow-md' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <button
              onClick={onToggleExpand}
              className="mt-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            
            <div className="flex-1">
              <div className="flex items-center space-x-3">
                <GitBranch className="h-5 w-5 text-blue-500" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                  Version {version.version}
                </h3>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  CHANGE_TYPE_COLORS[version.changeType]
                }`}>
                  {CHANGE_TYPE_LABELS[version.changeType]}
                </span>
              </div>
              
              <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                <div className="flex items-center">
                  <Clock className="h-4 w-4 mr-1" />
                  {new Date(version.createdAt).toISOString().split('T')[0]}
                </div>
                <div className="flex items-center">
                  <User className="h-4 w-4 mr-1" />
                  {version.createdBy}
                </div>
                <div className="flex items-center">
                  <FileText className="h-4 w-4 mr-1" />
                  {version.itemCount} items
                </div>
              </div>
              
              {version.description && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{version.description}</p>
              )}
              
              <div className="mt-3 flex items-center space-x-4">
                <div className="flex items-center text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-gray-600 dark:text-gray-400">
                    {version.mappedItems} mapped
                  </span>
                </div>
                {version.exceptionsCount > 0 && (
                  <div className="flex items-center text-sm">
                    <AlertTriangle className="h-4 w-4 text-orange-500 mr-1" />
                    <span className="text-gray-600 dark:text-gray-400">
                      {version.exceptionsCount} exceptions
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onSelect}
              className="rounded text-blue-600"
              title="Select for comparison"
            />
            
            <button
              onClick={onView}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
              title="View version"
            >
              <Eye className="h-4 w-4" />
            </button>
            
            <button
              onClick={onRestore}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
              title="Restore version"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            
            <button
              onClick={onExport}
              className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300"
              title="Export version"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      
      {isExpanded && version.changes && version.changes.length > 0 && (
        <div className="border-t px-4 py-3 bg-gray-50 dark:bg-gray-900">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recent Changes</h4>
          <div className="space-y-2">
            {version.changes.slice(0, 5).map(change => (
              <div key={change.id} className="flex items-start text-sm">
                <span className="text-gray-500 dark:text-gray-400 mr-2">•</span>
                <div className="flex-1">
                  <span className="text-gray-700 dark:text-gray-300">{change.description}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">
                    by {change.userId}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}