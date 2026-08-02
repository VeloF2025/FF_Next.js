const SAST_OFFSET = '+02:00';
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

export function localSastDateTimeToIso(localValue: string): string {
  if (!LOCAL_DATE_TIME.test(localValue)) {
    throw new Error('Enter a valid date and time.');
  }
  const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue;
  const parsed = new Date(`${withSeconds}${SAST_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Enter a valid date and time.');
  }
  return parsed.toISOString();
}
