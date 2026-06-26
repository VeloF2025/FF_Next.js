export function normaliseSerialCandidate(raw: string, prefix: string): string {
  const compact = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
  const match = compact.match(new RegExp(`${prefix}[A-Z0-9]+`));
  return match?.[0] ?? compact;
}
