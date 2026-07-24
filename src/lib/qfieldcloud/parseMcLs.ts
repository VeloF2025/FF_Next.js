/**
 * Pure parser for `mc ls --recursive` output over a project's DCIM/ prefix.
 * No child_process / logger imports — kept pure and unit-testable in isolation.
 */

/** mc's storage-class column value, when present (this deployment never tiers, but be defensive). */
const STORAGE_CLASSES = new Set(['STANDARD', 'REDUCED_REDUNDANCY']);

/** Matches the version suffix mc appends to each object key, e.g. "/v20260708123941-a8b6a554". */
const VERSION_SUFFIX = /\/v\d{14}-[a-f0-9]+$/i;

export interface ParseResult {
  keys: Set<string>;
  skipped: number;
}

/**
 * Parse raw `mc ls --recursive` stdout into logical DCIM keys (version suffix stripped,
 * `DCIM/` prefix restored — mc's relpaths are relative to the queried DCIM/ prefix, so they
 * omit it).
 *
 * mc ls line shape: "[<date> <time> <tz>] <size> [<STORAGE_CLASS>] <relpath...>"
 * relpath can legitimately contain spaces (phone-exported filenames such as
 * "JPEG_20260422084832831.28.16 (1).jpeg" are present in real project data), so the column
 * boundary must be decided deterministically — by checking whether the literal token at
 * index 4 is a known storage-class value — rather than by trying multiple slice offsets and
 * accepting whichever one happens to satisfy the version-suffix regex. The latter is
 * order-dependent and can spuriously validate a wrong split for a 4-column space-filename line.
 */
export function parseDcimKeys(stdout: string): ParseResult {
  const keys = new Set<string>();
  let skipped = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) {
      skipped++;
      continue;
    }
    const relStart = STORAGE_CLASSES.has(parts[4] ?? '') ? 5 : 4;
    const rel = parts.slice(relStart).join(' ');
    if (!rel || !VERSION_SUFFIX.test(rel)) {
      skipped++;
      continue;
    }
    const withoutVersion = rel.replace(VERSION_SUFFIX, '');
    keys.add(`DCIM/${withoutVersion}`);
  }
  return { keys, skipped };
}
