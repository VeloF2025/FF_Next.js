/**
 * Constant-time comparison for cron bearer secrets.
 *
 * A plain `!==` on a secret leaks its length and, byte by byte, its content through
 * comparison timing. That matters more than usual here: this repository has already
 * committed a cron secret once (scripts/cron-auto-qa.sh), so the threat model has to assume
 * these values are worth guessing.
 *
 * `pages/api/cron/fleet-parking-check.ts` carries an identical local copy predating this
 * module. It is left alone deliberately — it is merged, working code outside the scope of
 * the change that introduced this file — but it should adopt this helper next time it is
 * touched.
 */
import { timingSafeEqual } from 'crypto';

export function cronSecretMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // Unequal lengths cannot match, and timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
