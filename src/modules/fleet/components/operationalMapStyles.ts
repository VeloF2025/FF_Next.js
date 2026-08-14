import { divIcon, type DivIcon } from 'leaflet';
import type { OperationalStatusGroup } from '../operations/presentationTypes';
import type { OperationalStatus } from '../operations/types';

interface OperationalBadgeStyle {
  background: string;
  foreground: string;
  group: OperationalStatusGroup;
  label: string;
  symbol: string;
}

const GROUP_STYLES: Record<OperationalStatusGroup, Omit<OperationalBadgeStyle, 'group'>> = {
  on_site: { background: '#047857', foreground: '#ffffff', label: 'On site', symbol: '✓' },
  approaching: { background: '#0369a1', foreground: '#ffffff', label: 'Approaching', symbol: '→' },
  late: { background: '#b45309', foreground: '#ffffff', label: 'Late', symbol: '!' },
  wrong_site: { background: '#b91c1c', foreground: '#ffffff', label: 'Wrong site', symbol: '×' },
  mismatch: { background: '#be123c', foreground: '#ffffff', label: 'Evidence mismatch', symbol: '⇄' },
  left_early: { background: '#c2410c', foreground: '#ffffff', label: 'Left early', symbol: '↩' },
  unassigned: { background: '#6d28d9', foreground: '#ffffff', label: 'Unassigned', symbol: '?' },
  unverifiable: { background: '#4b5563', foreground: '#ffffff', label: 'Unverifiable', symbol: '…' },
  normal: { background: '#64748b', foreground: '#ffffff', label: 'Normal', symbol: '•' },
};

export function operationalBadgeGroup(status: OperationalStatus): OperationalStatusGroup {
  if (status === 'on_site_dual' || status === 'attendance_confirmed') return 'on_site';
  if (status === 'vehicle_on_site_driver_unconfirmed' || status === 'unverifiable') return 'unverifiable';
  if (status === 'evidence_mismatch') return 'mismatch';
  if (status === 'wrong_site' || status === 'late' || status === 'left_early'
    || status === 'unassigned' || status === 'approaching') return status;
  return 'normal';
}

export function operationalBadgeStyle(status: OperationalStatus): OperationalBadgeStyle {
  const group = operationalBadgeGroup(status);
  return { group, ...GROUP_STYLES[group] };
}

export function createOperationalBadgeIcon(status: OperationalStatus, selected: boolean): DivIcon {
  const style = operationalBadgeStyle(status);
  const groupClass = style.group.replaceAll('_', '-');
  const selectedClass = selected ? ' fleet-map-operational-badge--selected' : '';
  const outline = selected ? '0 0 0 3px #facc15,0 1px 4px #0f172a66' : '0 1px 4px #0f172a66';
  return divIcon({
    className: `fleet-map-operational-badge fleet-map-operational-badge--${groupClass}${selectedClass}`,
    html: `<span class="fleet-map-operational-badge__content" role="img" aria-label="${style.label} operational status" style="align-items:center;background:${style.background};border:2px solid #fff;border-radius:9999px;box-shadow:${outline};color:${style.foreground};display:flex;font-size:16px;font-weight:700;height:28px;justify-content:center;line-height:1;width:28px"><span aria-hidden="true">${style.symbol}</span></span>`,
    iconAnchor: [14, 14],
    iconSize: [28, 28],
    popupAnchor: [0, -14],
  });
}
