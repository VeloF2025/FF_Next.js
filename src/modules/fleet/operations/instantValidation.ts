const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/** Parses only real ISO-8601 instants; JavaScript's normalized dates are rejected. */
export function parseStrictIsoInstant(value: string): number | null {
  const match = ISO_INSTANT.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6]);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10]);
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return null;
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day); local.setUTCHours(hour, minute, second, millisecond);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day
    || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second
    || local.getUTCMilliseconds() !== millisecond) return null;
  const offsetSign = match[9] === '-' ? -1 : 1;
  const expected = local.getTime() - offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || parsed !== expected ? null : parsed;
}
