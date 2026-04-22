import { ModuleNav } from '../layout/ModuleNav';
import { TABS, getActiveTabId } from './attendanceNavConfig';

export function AttendanceNav() {
  return (
    <ModuleNav
      tabs={TABS}
      getActiveTabId={getActiveTabId}
      accentColor="emerald"
      navLabel="Attendance navigation"
    />
  );
}
