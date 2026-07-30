import type { ZoneDeliveryActivity } from '../types/zoneDelivery.types';
import { ZoneDeliveryTimestamp } from './ZoneDeliveryTimestamp';

const readableJson = (value: unknown) => JSON.stringify(value, null, 2);

export function ZoneActivityTimeline({ activity }: { activity: ZoneDeliveryActivity[] }) {
  return (
    <section aria-labelledby="activity-heading" className="rounded-lg border border-[var(--border-color)] p-4">
      <h2 id="activity-heading" className="mb-3 font-semibold text-[var(--ff-text-primary)]">Activity</h2>
      {activity.length === 0 ? (
        <p className="text-sm text-[var(--ff-text-secondary)]">No audited activity recorded.</p>
      ) : (
        <ol className="space-y-3">
          {activity.map(item => (
            <li key={item.id} aria-label={item.action} className="rounded bg-[var(--hover-bg)] p-3 text-sm text-[var(--ff-text-primary)]">
              <div className="font-medium">{item.action}</div>
              <div>Effective: <ZoneDeliveryTimestamp value={item.effectiveAt} label={`${item.action} effective time`} /> · Recorded: <ZoneDeliveryTimestamp value={item.recordedAt} label={`${item.action} recorded time`} /></div>
              <div>{item.actorEmail} · {item.permission}</div>
              <div>Source: {item.source}</div>
              {item.reason && <div>Reason: {item.reason}</div>}
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-black/20 p-2">Previous: {readableJson(item.previousValue)}</pre>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-black/20 p-2">New: {readableJson(item.newValue)}</pre>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
