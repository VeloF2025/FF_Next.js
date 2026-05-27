import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  LINK_FONT,
  gpsCoordinates,
  gpsMapsUrl,
  internalTicketUrl,
  setLinkCell,
  applyTicketRowLinks,
} from '../ticketLinkCells';

describe('gpsCoordinates', () => {
  it('joins lat/lng', () => {
    expect(gpsCoordinates(-26.1, 28.2)).toBe('-26.1, 28.2');
    expect(gpsCoordinates('-26.1', '28.2')).toBe('-26.1, 28.2');
  });
  it('returns empty string when either coordinate is missing', () => {
    expect(gpsCoordinates(null, 28.2)).toBe('');
    expect(gpsCoordinates(-26.1, null)).toBe('');
    expect(gpsCoordinates(undefined, undefined)).toBe('');
  });
  it('treats 0 as a valid coordinate (!= null, not falsy)', () => {
    expect(gpsCoordinates(0, 0)).toBe('0, 0');
  });
});

describe('gpsMapsUrl', () => {
  it('builds a Google Maps query URL', () => {
    expect(gpsMapsUrl(-26.1, 28.2)).toBe('https://www.google.com/maps?q=-26.1,28.2');
  });
  it('returns null when either coordinate is missing', () => {
    expect(gpsMapsUrl(null, 28.2)).toBeNull();
    expect(gpsMapsUrl(-26.1, undefined)).toBeNull();
  });
  it('treats 0 as a valid coordinate', () => {
    expect(gpsMapsUrl(0, 0)).toBe('https://www.google.com/maps?q=0,0');
  });
});

describe('internalTicketUrl', () => {
  it('builds a NOC ticket URL', () => {
    expect(internalTicketUrl('abc-123')).toMatch(/\/noc\/tickets\/abc-123$/);
  });
});

describe('setLinkCell', () => {
  it('writes a blue + underlined hyperlink cell', () => {
    const ws = new ExcelJS.Workbook().addWorksheet('t');
    const cell = ws.getCell('A1');
    setLinkCell(cell, 'label', 'https://example.com', 'tip');

    const value = cell.value as { text: string; hyperlink: string; tooltip?: string };
    expect(value.text).toBe('label');
    expect(value.hyperlink).toBe('https://example.com');
    expect(value.tooltip).toBe('tip');
    expect(cell.font).toEqual(LINK_FONT);
    expect(cell.font?.color?.argb).toBe('FF2563EB');
    expect(cell.font?.underline).toBe(true);
  });

  it('omits tooltip when not provided', () => {
    const ws = new ExcelJS.Workbook().addWorksheet('t');
    const cell = ws.getCell('A1');
    setLinkCell(cell, 'label', 'https://example.com');
    expect((cell.value as { tooltip?: string }).tooltip).toBeUndefined();
  });
});

describe('applyTicketRowLinks', () => {
  it('styles ticket, ticket-link and GPS cells when data is present', () => {
    const ws = new ExcelJS.Workbook().addWorksheet('t');
    const row = ws.addRow(['', '', '']);
    applyTicketRowLinks(row, {
      ticketCol: 1,
      ticketId: 'id-1',
      ticketUid: 'TKT-1',
      ticketLinkCol: 2,
      ticketLink: 'https://app/snag/resolve/tok',
      gpsCol: 3,
      lat: -26.1,
      lng: 28.2,
    });

    expect((row.getCell(1).value as { hyperlink: string }).hyperlink).toMatch(/\/noc\/tickets\/id-1$/);
    expect((row.getCell(1).value as { text: string }).text).toBe('TKT-1');
    expect((row.getCell(2).value as { hyperlink: string }).hyperlink).toBe('https://app/snag/resolve/tok');
    expect((row.getCell(3).value as { hyperlink: string }).hyperlink).toBe('https://www.google.com/maps?q=-26.1,28.2');
    expect((row.getCell(3).value as { text: string }).text).toBe('-26.1, 28.2');
  });

  it('leaves the ticket cell plain when ticketId is present but ticketUid is null', () => {
    const ws = new ExcelJS.Workbook().addWorksheet('t');
    const row = ws.addRow(['plain']);
    applyTicketRowLinks(row, { ticketCol: 1, ticketId: 'id-1', ticketUid: null });
    expect(row.getCell(1).value).toBe('plain');
    expect(row.getCell(1).font).toBeUndefined();
  });

  it('leaves cells untouched when data is missing', () => {
    const ws = new ExcelJS.Workbook().addWorksheet('t');
    const row = ws.addRow(['plain', 'plain', 'plain']);
    applyTicketRowLinks(row, {
      ticketCol: 1,
      ticketId: null,
      ticketUid: null,
      ticketLinkCol: 2,
      ticketLink: null,
      gpsCol: 3,
      lat: null,
      lng: null,
    });

    expect(row.getCell(1).value).toBe('plain');
    expect(row.getCell(2).value).toBe('plain');
    expect(row.getCell(3).value).toBe('plain');
    expect(row.getCell(1).font).toBeUndefined();
  });
});
