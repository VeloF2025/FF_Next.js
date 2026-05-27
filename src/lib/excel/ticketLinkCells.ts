/**
 * Shared ExcelJS link-cell helpers for data exports.
 *
 * Renders the three recurring "clickable" columns used across the activate/OLT
 * exports — Ticket (internal NOC page), Ticket Link (public shareable page) and
 * GPS coordinates (Google Maps) — as Excel's default hyperlink look: blue +
 * underlined.
 *
 * SheetJS (xlsx) can write hyperlinks but silently drops cell font styling, so
 * every styled export must build its workbook with ExcelJS and use these helpers.
 */

import type ExcelJS from 'exceljs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';

type Coord = number | string | null | undefined;

/** Excel's default hyperlink look: blue + underlined. */
export const LINK_FONT: Partial<ExcelJS.Font> = {
  color: { argb: 'FF2563EB' },
  underline: true,
};

/** "lat, lng" display string, or '' when either coordinate is missing. */
export function gpsCoordinates(lat: Coord, lng: Coord): string {
  return lat != null && lng != null ? `${lat}, ${lng}` : '';
}

/** Google Maps URL for a coordinate pair, or null when either is missing. */
export function gpsMapsUrl(lat: Coord, lng: Coord): string | null {
  return lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
}

/** Internal FibreFlow NOC ticket page (sign-in required). */
export function internalTicketUrl(ticketId: string): string {
  return `${APP_URL}/noc/tickets/${ticketId}`;
}

/** Turn a worksheet cell into a blue + underlined clickable hyperlink. */
export function setLinkCell(
  cell: ExcelJS.Cell,
  text: string,
  hyperlink: string,
  tooltip?: string,
): void {
  cell.value = { text, hyperlink, ...(tooltip ? { tooltip } : {}) };
  cell.font = LINK_FONT;
}

/**
 * Apply the standard Ticket / Ticket Link / GPS link styling to a freshly added
 * worksheet row. Column positions are 1-based; pass `null`/`undefined` for any
 * column the sheet does not include to skip it.
 */
export function applyTicketRowLinks(
  row: ExcelJS.Row,
  opts: {
    ticketCol?: number | null;
    ticketId?: string | null;
    ticketUid?: string | null;
    ticketLinkCol?: number | null;
    ticketLink?: string | null;
    gpsCol?: number | null;
    lat?: Coord;
    lng?: Coord;
  },
): void {
  if (opts.ticketCol && opts.ticketId && opts.ticketUid) {
    setLinkCell(
      row.getCell(opts.ticketCol),
      opts.ticketUid,
      internalTicketUrl(opts.ticketId),
      'Open ticket in FibreFlow (sign-in required)',
    );
  }
  if (opts.ticketLinkCol && opts.ticketLink) {
    setLinkCell(row.getCell(opts.ticketLinkCol), opts.ticketLink, opts.ticketLink, 'Open shareable ticket link');
  }
  if (opts.gpsCol) {
    const mapsUrl = gpsMapsUrl(opts.lat, opts.lng);
    if (mapsUrl) {
      setLinkCell(row.getCell(opts.gpsCol), gpsCoordinates(opts.lat, opts.lng), mapsUrl, 'Open in Google Maps');
    }
  }
}
