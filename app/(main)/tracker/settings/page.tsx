'use client';

import { Settings } from 'lucide-react';
import { TrackerSelectListAdmin } from '@/modules/tracker/components/TrackerSelectListAdmin';

export default function TrackerSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Tracker Settings</h1>
          <p className="text-sm text-slate-400">Manage dropdown values used across PON and Master trackers</p>
        </div>
      </div>

      {/* Admin component */}
      <TrackerSelectListAdmin />
    </div>
  );
}
