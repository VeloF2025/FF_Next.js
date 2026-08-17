const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function fleetAlertUserIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((value) => value.trim().toLowerCase()).filter((value) => UUID.test(value)))];
}
