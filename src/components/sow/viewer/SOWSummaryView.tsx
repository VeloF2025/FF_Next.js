/**
 * SOW Data Summary View
 */

import { MapPin, Home, Cable } from 'lucide-react';

interface SOWSummary {
  total_poles?: number;
  total_drops?: number;
  total_fibre_segments?: number;
  total_fibre_length?: number;
}

interface SOWSummaryViewProps {
  summary: SOWSummary;
}

export function SOWSummaryView({ summary }: SOWSummaryViewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-blue-50 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-2">
          <MapPin className="w-5 h-5 text-blue-600" />
          <span className="text-sm font-medium text-blue-900">Total Poles</span>
        </div>
        <p className="text-2xl font-semibold text-blue-700">
          {summary.total_poles || 0}
        </p>
      </div>

      <div className="bg-green-50 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-2">
          <Home className="w-5 h-5 text-green-600" />
          <span className="text-sm font-medium text-green-900">Total Drops</span>
        </div>
        <p className="text-2xl font-semibold text-green-700">
          {summary.total_drops || 0}
        </p>
      </div>

      <div className="bg-purple-50 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-2">
          <Cable className="w-5 h-5 text-purple-600" />
          <span className="text-sm font-medium text-purple-900">Fibre Segments</span>
        </div>
        <p className="text-2xl font-semibold text-purple-700">
          {summary.total_fibre_segments || 0}
        </p>
      </div>

      <div className="bg-orange-50 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-2">
          <Cable className="w-5 h-5 text-orange-600" />
          <span className="text-sm font-medium text-orange-900">Total Length</span>
        </div>
        <p className="text-2xl font-semibold text-orange-700">
          {(summary.total_fibre_length || 0).toLocaleString()}m
        </p>
      </div>
    </div>
  );
}