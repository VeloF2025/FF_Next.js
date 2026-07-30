import type {
  ZoneDeliveryView,
  ZoneSnagView,
} from '../types/zoneDelivery.types';
import { ZoneDeliveryTimestamp } from './ZoneDeliveryTimestamp';

const titleCase = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

function originLabel(zone: ZoneDeliveryView, snag: ZoneSnagView): string {
  if (snag.qaDiscipline === 'civil') return 'Civil Zone QA';
  if (snag.qaDiscipline === 'optical') return 'Optical Zone QA';
  if (zone.status === 'handed_over'
    && !snag.handoverBlocking
    && !snag.requiresReconfirmation) return 'Maintenance';
  if (snag.affectedGate) return `${titleCase(snag.affectedGate)} gate`;
  return 'Zone delivery';
}

function snagUrl(zone: ZoneDeliveryView, snag: ZoneSnagView): string {
  const base = `project_id=${encodeURIComponent(zone.projectId)}&zone_no=${zone.zoneNo}`;
  return `/field-ops/snags?${base}${snag.ponNo === undefined ? '' : `&pon_no=${snag.ponNo}`}`;
}

export function ZoneDeliverySnags({ zone }: { zone: ZoneDeliveryView }) {
  return (
    <section aria-labelledby="linked-snags-heading" className="rounded-lg border border-[var(--border-color)] p-4">
      <h2 id="linked-snags-heading" className="mb-3 font-semibold">Linked snags</h2>
      {zone.snags.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-secondary)]">No linked snags.</p>
      ) : (
        <ul className="space-y-3">
          {zone.snags.map(snag => (
            <li key={snag.snagId} className="rounded border border-[var(--border-color)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{originLabel(zone, snag)}</span>
                  <span>{titleCase(snag.status)}</span>
                  {snag.ponNo !== undefined && <span>PON {snag.ponNo}</span>}
                  <span>{snag.handoverBlocking ? 'Blocking' : 'Non-blocking'}</span>
                </div>
                <a
                  aria-label={`Open snag ${snag.snagId}`}
                  className="underline"
                  href={snagUrl(zone, snag)}
                >
                  Open snag
                </a>
              </div>
              {snag.closedAt && (
                <p className="mt-2 text-[var(--ff-text-secondary)]">
                  Closed: <ZoneDeliveryTimestamp value={snag.closedAt} label={`Snag ${snag.snagId} close time`} />
                </p>
              )}
              {snag.requiresReconfirmation && (
                <p className="mt-2 text-amber-300">Milestone reconfirmation required.</p>
              )}
              {snag.reconfirmedAt && (
                <p className="mt-2 text-[var(--ff-text-secondary)]">
                  Reconfirmed: <ZoneDeliveryTimestamp value={snag.reconfirmedAt} label={`Snag ${snag.snagId} reconfirmation time`} />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
