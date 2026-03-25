/**
 * Analytics Reports — Operations sub-page
 * Expandable report cards — same structure as Financial tab.
 * 🟢 WORKING: Activations card with Table + Charts tabs
 */

'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import ActivationsReport from '@/modules/analytics/reports/activations/ActivationsReport';
import BuildMilestonesReport from '@/modules/analytics/reports/build-milestones/BuildMilestonesReport';

const OPERATIONS_REPORTS = [
  {
    id: 'activations',
    name: 'Activations',
    description: 'OES activations by year, month and week — project split with revenue estimate',
  },
  {
    id: 'build-milestones',
    name: 'Build Milestone Overview',
    description: 'RFO (Civil Work Complete) and ATP progress per project',
  },
];

const REPORT_COMPONENTS: Record<string, React.ComponentType> = {
  activations: ActivationsReport,
  'build-milestones': BuildMilestonesReport,
};

export default function OperationsReportsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {OPERATIONS_REPORTS.map((report) => {
        const isExpanded = expandedId === report.id;
        const ReportComponent = REPORT_COMPONENTS[report.id];
        return (
          <div key={report.id} className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <BarChart2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <div>
                  <h2 className="text-white font-semibold">{report.name}</h2>
                  <p className="text-sm text-gray-400">{report.description}</p>
                </div>
              </div>
              <button
                onClick={() => setExpandedId(isExpanded ? null : report.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                {isExpanded ? (
                  <><ChevronUp className="w-4 h-4" />Close</>
                ) : (
                  <><ChevronDown className="w-4 h-4" />View Report</>
                )}
              </button>
            </div>
            {/* Expanded content */}
            {isExpanded && ReportComponent && (
              <div className="border-t border-gray-700 p-4">
                <ReportComponent />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
