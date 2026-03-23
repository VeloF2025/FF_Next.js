/**
 * PBI (Power BI) dark theme tokens — used across all analytics report components.
 * Source: Lew directive 2026-03-21, PBI dark theme colour palette.
 */

export const PBI = {
  primary:     '#118DFF',
  positive:    '#107C10',
  negative:    '#D13438',
  surface:     '#252423',
  header:      '#1a3a4a',
  rowAlt:      'rgba(255,255,255,0.04)',
  border:      '#3a3a3a',
  textPrimary: '#F3F3F3',
  textMuted:   '#9CA3AF',
} as const;

/** R 1 234 567 — zero/null → '—' */
export function fZAR(v: number): string {
  if (!isFinite(v) || v === 0) return '\u2014';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

/** R1.5M / R45k compact */
export function fZARCompact(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}R${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}R${(abs / 1_000).toFixed(0)}k`;
  return `${sign}R${Math.round(abs)}`;
}

/** 23.2% */
export function fPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** 1 234 integer */
export function fNum(v: number): string {
  if (!isFinite(v) || v === 0) return '\u2014';
  return Math.round(Math.abs(v)).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}
