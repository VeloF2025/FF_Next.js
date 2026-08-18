/**
 * /fleet/incidents — the manager incident-review queue (design §11.1). A
 * workflow queue inside the existing Fleet/Operations shell, not a new
 * dashboard: `IncidentQueue` owns filters/table/drawer/settings, this page
 * only resolves the viewer's `fleet.incidents`/`fleet.incidents-settings`
 * permissions and renders the Fleet page shell around it.
 */
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { usePermission } from '@/hooks/usePermission';
import { fleetConfig } from '@/modules/navigation';
import { IncidentQueue } from '@/modules/fleet/incidents/web/IncidentQueue';

export default function FleetIncidentsPage() {
  const { can, isLoading } = usePermission();
  const canEdit = !isLoading && can('fleet.incidents', 'edit');
  const canManageSettings = !isLoading && can('fleet.incidents-settings', 'edit');

  return (
    <AppLayout>
      <ModulePage config={fleetConfig} hideTabs>
        <div className="p-6">
          {isLoading ? (
            <p className="text-sm text-[var(--ff-text-secondary)]">Loading…</p>
          ) : (
            <IncidentQueue canEdit={canEdit} canManageSettings={canManageSettings} />
          )}
        </div>
      </ModulePage>
    </AppLayout>
  );
}
