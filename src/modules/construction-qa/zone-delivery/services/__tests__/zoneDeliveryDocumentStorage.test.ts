import { createHash } from 'crypto';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import type { ZoneDeliveryService } from '../zoneDeliveryService';
import type { ZoneDeliveryView } from '../../types/zoneDelivery.types';
import {
  MAX_ZONE_DOCUMENT_BYTES,
  storeZoneDeliveryDocument,
} from '../zoneDeliveryDocumentStorage';

const key = {
  projectId: '11111111-1111-4111-8111-111111111111',
  zoneNo: 7,
  expectedRowVersion: 3,
  effectiveAt: '2026-07-30T08:00:00.000Z',
  source: 'signed handover register',
};
const actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  email: 'qa@example.com',
  permission: 'construction-qa.zone-delivery.documents-manage',
};
const before = {
  ...key,
  documents: [{
    id: 'old-document',
    documentType: 'fac',
    sourceRef: '/storage/old.pdf',
    url: '/storage/old.pdf',
    checksumSha256: '0'.repeat(64),
    active: true,
  }],
} as unknown as ZoneDeliveryView;
const after = {
  ...before,
  documents: [
    { ...before.documents[0], active: false },
    {
      id: 'new-document',
      documentType: 'fac',
      sourceRef: '/storage/zone-delivery/documents/saved.pdf',
      url: '/storage/zone-delivery/documents/saved.pdf',
      checksumSha256: '1'.repeat(64),
      active: true,
    },
  ],
} as ZoneDeliveryView;

function dependencies() {
  const service = {
    getZone: vi.fn().mockResolvedValue(before),
    registerDocument: vi.fn().mockResolvedValue(after),
  } as unknown as ZoneDeliveryService;
  const storage = {
    uploadFile: vi.fn().mockResolvedValue({
      success: true,
      filename: 'saved.pdf',
      path: 'zone-delivery/documents/saved.pdf',
      url: '/storage/zone-delivery/documents/saved.pdf',
      size: 13,
    }),
    deleteFile: vi.fn().mockResolvedValue(true),
  };
  return { service, storage };
}

describe('zone delivery document storage', () => {
  it('accepts a valid PDF signature', async () => {
    const deps = dependencies();
    await storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'fac' },
      actor,
      file: {
        buffer: Buffer.from('%PDF-1.4 test'),
        mimeType: 'application/pdf',
        originalFilename: 'evidence.pdf',
      },
    });
    expect(deps.storage.uploadFile).toHaveBeenCalledOnce();
    expect(deps.service.registerDocument).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'word/document.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      'cac',
      'evidence.docx',
    ],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xl/workbook.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      'test_pack',
      'evidence.xlsx',
    ],
  ] as const)('accepts a structurally valid %s package', async (
    mimeType,
    mainPart,
    mainContentType,
    documentType,
    originalFilename,
  ) => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<Types><Override PartName="/${mainPart}" ContentType="${mainContentType}"/></Types>`);
    zip.file('_rels/.rels', '<Relationships/>');
    zip.file(mainPart, '<document/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const deps = dependencies();
    await storeZoneDeliveryDocument({
      ...deps,
      command: {
        ...key,
        documentType,
        ponStageId: documentType === 'test_pack' ? actor.userId : undefined,
      },
      actor,
      file: { buffer, mimeType, originalFilename },
    });
    expect(deps.storage.uploadFile).toHaveBeenCalledOnce();
  });

  it('rejects a ZIP signature that is not a valid OOXML package', async () => {
    const deps = dependencies();
    await expect(storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'cac' },
      actor,
      file: {
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        originalFilename: 'evidence.docx',
      },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(deps.storage.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a mismatched magic signature before storage or metadata', async () => {
    const deps = dependencies();
    await expect(storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'fac' },
      actor,
      file: {
        buffer: Buffer.from('not a PDF'),
        mimeType: 'application/pdf',
        originalFilename: 'evidence.pdf',
      },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(deps.storage.uploadFile).not.toHaveBeenCalled();
    expect(deps.service.registerDocument).not.toHaveBeenCalled();
  });

  it('rejects bytes beyond the 50 MiB limit', async () => {
    const deps = dependencies();
    await expect(storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'fac' },
      actor,
      file: {
        buffer: Buffer.alloc(MAX_ZONE_DOCUMENT_BYTES + 1),
        mimeType: 'application/pdf',
        originalFilename: 'large.pdf',
      },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(deps.storage.uploadFile).not.toHaveBeenCalled();
  });

  it('sanitizes the filename, hashes bytes, and returns complete audit metadata', async () => {
    const deps = dependencies();
    const buffer = Buffer.from('%PDF-1.4 test');
    const result = await storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'fac' },
      actor,
      file: {
        buffer,
        mimeType: 'application/pdf',
        originalFilename: '../../Résumé Q2?.pdf',
      },
    });

    expect(deps.storage.uploadFile).toHaveBeenCalledWith(
      buffer,
      'zone-delivery',
      'documents',
      'Resume_Q2_.pdf',
    );
    expect(deps.service.registerDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentSource: 'vf_storage',
        sourceRef: '/storage/zone-delivery/documents/saved.pdf',
        filename: 'saved.pdf',
        mimeType: 'application/pdf',
        sizeBytes: buffer.length,
        checksumSha256: createHash('sha256').update(buffer).digest('hex'),
      }),
      actor,
    );
    expect(result).toEqual({
      zone: after,
      document: {
        source: 'vf_storage',
        sourceRef: '/storage/zone-delivery/documents/saved.pdf',
        filename: 'saved.pdf',
        mimeType: 'application/pdf',
        sizeBytes: buffer.length,
        checksumSha256: createHash('sha256').update(buffer).digest('hex'),
        effectiveAt: key.effectiveAt,
        uploader: { userId: actor.userId, email: actor.email },
        supersededDocumentId: 'old-document',
      },
    });
  });

  it('does not write or supersede metadata when VF Storage fails', async () => {
    const deps = dependencies();
    deps.storage.uploadFile.mockRejectedValue(new Error('VF unavailable'));
    await expect(storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'fac' },
      actor,
      file: {
        buffer: Buffer.from('%PDF-1.4 test'),
        mimeType: 'application/pdf',
        originalFilename: 'evidence.pdf',
      },
    })).rejects.toThrow('VF unavailable');
    expect(deps.service.registerDocument).not.toHaveBeenCalled();
  });

  it('registers only after upload and deletes the uploaded object if registration fails', async () => {
    const deps = dependencies();
    deps.service.registerDocument = vi.fn().mockRejectedValue(new Error('database failed'));
    await expect(storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'fac' },
      actor,
      file: {
        buffer: Buffer.from('%PDF-1.4 test'),
        mimeType: 'application/pdf',
        originalFilename: 'evidence.pdf',
      },
    })).rejects.toThrow('database failed');
    expect(deps.storage.uploadFile.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.service.registerDocument).mock.invocationCallOrder[0]!);
    expect(deps.storage.deleteFile).toHaveBeenCalledWith(
      'zone-delivery',
      'documents',
      'saved.pdf',
    );
  });

  it('preserves the metadata error when compensating delete also rejects', async () => {
    const deps = dependencies();
    const metadataError = new Error('metadata transaction failed');
    deps.service.registerDocument = vi.fn().mockRejectedValue(metadataError);
    deps.storage.deleteFile.mockRejectedValue(new Error('cleanup transport failed'));
    const result = storeZoneDeliveryDocument({
      ...deps,
      command: { ...key, documentType: 'fac' },
      actor,
      file: {
        buffer: Buffer.from('%PDF-1.4 test'),
        mimeType: 'application/pdf',
        originalFilename: 'evidence.pdf',
      },
    });
    await expect(result).rejects.toBe(metadataError);
    expect(deps.storage.deleteFile).toHaveBeenCalledWith(
      'zone-delivery',
      'documents',
      'saved.pdf',
    );
  });
});
