/**
 * BOQ Quick Actions Component
 */

import { Upload, FileText, BarChart3, Download, ArrowRight } from 'lucide-react';

interface BOQQuickActionsProps {
  onUpload: () => void;
  onViewList: () => void;
  onViewAnalytics: () => void;
  onExport: () => void;
}

export default function BOQQuickActions({
  onUpload,
  onViewList,
  onViewAnalytics,
  onExport
}: BOQQuickActionsProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Quick Actions</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Common BOQ management tasks</p>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={onUpload}
            className="flex items-center p-4 border-2 border-dashed border-blue-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors group"
          >
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200">
                <Upload className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Upload New BOQ</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Import from Excel or CSV</p>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
            </div>
          </button>

          <button
            onClick={onViewList}
            className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors group"
          >
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <FileText className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">View All BOQs</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Browse and manage</p>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
            </div>
          </button>

          <button
            onClick={onViewAnalytics}
            className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors group"
          >
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 rounded-lg">
                <BarChart3 className="h-6 w-6 text-purple-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Analytics</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Reports and insights</p>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
            </div>
          </button>

          <button
            onClick={onExport}
            className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors group"
          >
            <div className="flex items-center">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Download className="h-6 w-6 text-orange-600" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Export Data</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Download reports</p>
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}