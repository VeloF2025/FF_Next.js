/**
 * Human labels for stock_serial_events.event_type values shown in the serial
 * timeline. Kept in its own module (not the component file) so it can be shared
 * and unit-tested without tripping react-refresh/only-export-components.
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  installed_at_drop: 'Installed at drop',
  activated: 'Activated',
  // Non-authoritative recon: the unit's serial was read off a WhatsApp photo.
  wa_photo_sighting: 'Seen in WhatsApp photo',
};

/** Human label for an event_type; humanizes unknown (snake_case) types. */
export function eventTypeLabel(eventType: string): string {
  return (
    EVENT_TYPE_LABELS[eventType] ??
    eventType.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  );
}
