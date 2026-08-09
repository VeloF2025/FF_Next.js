import { createHash } from 'crypto';
import JSZip from 'jszip';
import { log } from '@/lib/logger';
import { vfStorage } from '@/services/vfStorageAdapter';
import type { VFStorageService } from '@/services/vfStorageAdapter';
import type {
  DeliveryActor,
  RegisterDocumentInput,
  ZoneDeliveryView,
} from '../types/zoneDelivery.types';
import type { ZoneDeliveryService } from './zoneDeliveryService';
import { deliveryError, ZoneDeliveryError } from './zoneDeliveryErrors';

export const MAX_ZONE_DOCUMENT_BYTES = 50 * 1024 * 1024;

const FILE_TYPES = {
  'application/pdf': { extension: '.pdf', signature: [0x25, 0x50, 0x44, 0x46] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: '.docx', signature: [0x50, 0x4b, 0x03, 0x04],
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extension: '.xlsx', signature: [0x50, 0x4b, 0x03, 0x04],
  },
} as const;
type UploadMime = keyof typeof FILE_TYPES;
const OOXML_TYPES = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    mainPart: 'word/document.xml',
    mainContentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    mainPart: 'xl/workbook.xml',
    mainContentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  },
} as const;

interface StorageAdapter {
  uploadFile: VFStorageService['uploadFile'];
  deleteFile: VFStorageService['deleteFile'];
}
interface UploadCommand {
  projectId: string;
  zoneNo: number;
  expectedRowVersion: number;
  effectiveAt: string;
  source: string;
  reason?: string;
  documentType: RegisterDocumentInput['documentType'];
  ponStageId?: string;
}
export interface DocumentAuditMetadata {
  source: RegisterDocumentInput['documentSource'];
  sourceRef: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  effectiveAt: string;
  uploader: { userId: string; email: string };
  supersededDocumentId?: string;
}

const matchesSignature = (buffer: Buffer, signature: readonly number[]): boolean =>
  signature.every((byte, index) => buffer[index] === byte);

async function hasValidFileStructure(
  buffer: Buffer,
  mimeType: UploadMime,
): Promise<boolean> {
  if (!matchesSignature(buffer, FILE_TYPES[mimeType].signature)) return false;
  if (mimeType === 'application/pdf') return true;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const contentTypesEntry = zip.file('[Content_Types].xml');
    const config = OOXML_TYPES[mimeType];
    if (!contentTypesEntry || !zip.file('_rels/.rels') || !zip.file(config.mainPart)) {
      return false;
    }
    const metadata = contentTypesEntry as unknown as {
      _data?: { uncompressedSize?: number };
    };
    if ((metadata._data?.uncompressedSize ?? 0) > 1024 * 1024) return false;
    const contentTypes = await contentTypesEntry.async('string');
    return contentTypes.includes(`PartName="/${config.mainPart}"`)
      && contentTypes.includes(`ContentType="${config.mainContentType}"`);
  } catch {
    return false;
  }
}

export function sanitizeZoneDocumentFilename(original: string, mimeType: UploadMime): string {
  const extension = FILE_TYPES[mimeType].extension;
  const baseName = original.replace(/\\/g, '/').split('/').pop() ?? '';
  const withoutExtension = baseName.slice(0, Math.max(0, baseName.length - extension.length));
  const ascii = withoutExtension.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const safeBase = ascii
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+/g, '')
    .slice(0, 100) || 'document';
  return `${safeBase}${extension}`;
}

export function activeDocumentId(
  zone: ZoneDeliveryView,
  documentType: RegisterDocumentInput['documentType'],
  ponStageId?: string,
): string | undefined {
  return zone.documents.find(document =>
    document.active
    && document.documentType === documentType
    && (documentType === 'test_pack'
      ? document.ponStageId === ponStageId
      : document.ponStageId === undefined))?.id;
}

export function documentAuditMetadata(
  input: RegisterDocumentInput,
  actor: DeliveryActor,
  supersededDocumentId?: string,
): DocumentAuditMetadata {
  return {
    source: input.documentSource,
    sourceRef: input.sourceRef,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
    effectiveAt: input.effectiveAt,
    uploader: { userId: actor.userId, email: actor.email },
    ...(supersededDocumentId ? { supersededDocumentId } : {}),
  };
}

export async function storeZoneDeliveryDocument(args: {
  command: UploadCommand;
  actor: DeliveryActor;
  file: { buffer: Buffer; mimeType: string; originalFilename: string };
  service: ZoneDeliveryService;
  storage?: StorageAdapter;
}): Promise<{ zone: ZoneDeliveryView; document: DocumentAuditMetadata }> {
  const { command, actor, file, service, storage = vfStorage } = args;
  if (file.buffer.length > MAX_ZONE_DOCUMENT_BYTES) {
    deliveryError('VALIDATION_ERROR', 'Document exceeds the 50 MiB limit');
  }
  const config = FILE_TYPES[file.mimeType as UploadMime];
  if (!config || !(await hasValidFileStructure(file.buffer, file.mimeType as UploadMime))
    || !file.originalFilename.toLowerCase().endsWith(config.extension)) {
    deliveryError('VALIDATION_ERROR', 'Document MIME, extension, or signature is invalid');
  }
  const safeName = sanitizeZoneDocumentFilename(file.originalFilename, file.mimeType as UploadMime);
  // This read exists only to name the document being superseded. A zone that
  // FibreFlow has never recorded anything against has no canonical PON rows, so
  // the read fails with ZONE_NOT_FOUND — and it is `registerDocument` below
  // that seeds those rows. Letting the read's failure escape made the very
  // first upload on such a zone impossible, which is every zone in the eight
  // projects the 1Map sync does not cover. Nothing is superseded on a zone with
  // no documents, so the absence is simply the answer.
  const before = await service.getZone(command).catch((error: unknown) => {
    if (error instanceof ZoneDeliveryError && error.code === 'ZONE_NOT_FOUND') return null;
    throw error;
  });
  const supersededDocumentId = before
    ? activeDocumentId(before, command.documentType, command.ponStageId)
    : undefined;
  let uploadedFilename: string | undefined;
  try {
    const uploaded = await storage.uploadFile(
      file.buffer,
      'zone-delivery',
      'documents',
      safeName,
    );
    uploadedFilename = uploaded.filename;
    const input: RegisterDocumentInput = {
      ...command,
      documentSource: 'vf_storage',
      sourceRef: uploaded.url,
      filename: uploaded.filename,
      mimeType: file.mimeType,
      sizeBytes: file.buffer.length,
      checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
    const zone = await service.registerDocument(input, actor);
    return { zone, document: documentAuditMetadata(input, actor, supersededDocumentId) };
  } catch (error) {
    if (uploadedFilename) {
      try {
        const deleted = await storage.deleteFile('zone-delivery', 'documents', uploadedFilename);
        if (!deleted) {
          log.error('Zone delivery upload cleanup failed', {
            projectId: command.projectId,
            zoneNo: command.zoneNo,
            filename: uploadedFilename,
          });
        }
      } catch (cleanupError) {
        log.error('Zone delivery upload cleanup failed', {
          projectId: command.projectId,
          zoneNo: command.zoneNo,
          filename: uploadedFilename,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    log.error('Zone delivery document storage failed', {
      projectId: command.projectId,
      zoneNo: command.zoneNo,
      filename: safeName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
