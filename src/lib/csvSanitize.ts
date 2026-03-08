/**
 * Sanitize a value for CSV output to prevent formula injection.
 * Prefixes cells starting with =, +, -, @, tab, or carriage return with a single quote.
 * Also escapes embedded double quotes.
 */
export function csvSanitize(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const str = String(value).replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(str)) {
    return `"'${str}"`;
  }
  return `"${str}"`;
}
