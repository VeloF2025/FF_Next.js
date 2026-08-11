/**
 * The attachment policy decides where a file is written, and therefore whether
 * it is reachable over the public internet. That makes it worth testing on its
 * own rather than only through an upload.
 *
 * The load-bearing property is the first test: every surface resolves to the
 * private storage type. A surface added later with any other type would be
 * published rather than merely misfiled, and nothing else in the stack would
 * notice — nginx guards a prefix, not a table.
 */

import { describe, it, expect } from 'vitest';
import {
  ATTACHMENT_SURFACES,
  VF_PRIVATE_STORAGE_TYPE,
  isAttachmentSurface,
  isPrivateStoragePath,
  storageLocation,
  surfaceConfig,
  type AttachmentSurface,
} from '../services/hsAttachmentPolicy';

describe('hsAttachmentPolicy', () => {
  it('writes every surface under the private storage type', () => {
    for (const surface of ATTACHMENT_SURFACES) {
      expect(storageLocation(surface).type, `${surface} must be private`).toBe(
        VF_PRIVATE_STORAGE_TYPE
      );
    }
  });

  it('covers the eight surfaces the migrations created columns for', () => {
    // Guards against a column existing with no way to reach it, and against a
    // surface existing with no column — both compile fine.
    expect([...ATTACHMENT_SURFACES].sort()).toEqual(
      [
        'capa',
        'contractor_document',
        'letter',
        'library',
        'medical',
        'permit',
        'ppe_acknowledgement',
        'talk',
      ].sort()
    );
  });

  it('gives each surface a distinct storage category', () => {
    // Two surfaces sharing a directory would let a filename collision put one
    // record's document under another's.
    const categories = ATTACHMENT_SURFACES.map((s) => storageLocation(s).category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it('gives each surface a distinct parent column', () => {
    const columns = ATTACHMENT_SURFACES.map((s) => surfaceConfig(s).parentColumn);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it('rejects anything that is not a known surface', () => {
    expect(isAttachmentSurface('medical')).toBe(true);
    expect(isAttachmentSurface('medicals')).toBe(false);
    expect(isAttachmentSurface('')).toBe(false);
    expect(isAttachmentSurface(null)).toBe(false);
    expect(isAttachmentSurface(undefined)).toBe(false);
    // Inherited Object members are properties of the prototype, not surfaces;
    // a plain `in` check would accept these and hand back an undefined config.
    expect(isAttachmentSurface('toString')).toBe(false);
    expect(isAttachmentSurface('constructor')).toBe(false);
  });

  it('recognises only paths under the private prefix', () => {
    expect(isPrivateStoragePath('hs-private/medicals/file.pdf')).toBe(true);
    expect(isPrivateStoragePath('staff/documents/file.pdf')).toBe(false);
    // A prefix that merely starts with the same characters is a different
    // directory, and nginx would not be guarding it.
    expect(isPrivateStoragePath('hs-privatex/medicals/file.pdf')).toBe(false);
    expect(isPrivateStoragePath('')).toBe(false);
  });

  it('never lets a parent column or table carry SQL-unsafe characters', () => {
    // These two values are interpolated into SQL because a column name cannot
    // be a bind parameter. They are only safe while they stay identifier-shaped.
    const identifier = /^[a-z_][a-z0-9_]*$/;
    for (const surface of ATTACHMENT_SURFACES as AttachmentSurface[]) {
      const { parentColumn, parentTable } = surfaceConfig(surface);
      expect(parentColumn).toMatch(identifier);
      expect(parentTable).toMatch(identifier);
    }
  });
});

describe('isPrivateStoragePath — traversal', () => {
  it('rejects a path that walks back out of the private prefix', () => {
    // Satisfies a plain startsWith check, but the storage service would
    // resolve it straight out of the guarded directory.
    expect(isPrivateStoragePath('hs-private/../staff/documents/payslip.pdf')).toBe(false);
    expect(isPrivateStoragePath('hs-private/medicals/../../staff/documents/x.pdf')).toBe(false);
  });

  it('rejects backslashes and control characters', () => {
    expect(isPrivateStoragePath('hs-private/medicals\\..\\staff\\x.pdf')).toBe(false);
    // A newline would split the request line sent to the storage service.
    expect(isPrivateStoragePath('hs-private/medicals/x.pdf\nGET /staff/y.pdf')).toBe(false);
    expect(isPrivateStoragePath('hs-private/medicals/x\u0000.pdf')).toBe(false);
  });

  it('still accepts a normal stored path', () => {
    // The rejections above must not be so broad that they refuse real files;
    // VF Storage names objects <epoch>-<hex>.<ext>.
    expect(isPrivateStoragePath('hs-private/medicals/1786444140027-09c3a05978d8a212.pdf')).toBe(true);
    expect(isPrivateStoragePath('hs-private/appointment_letters/1786444140027-aa.docx')).toBe(true);
  });
});
