import { createHash } from 'crypto';
import { log } from '@/lib/logger';
import { vfStorage } from '@/services/vfStorageAdapter';
import type { VFStorageService } from '@/services/vfStorageAdapter';
import type {
  DeliveryActor,
  RegisterDocumentInput,
  ZoneDeliveryView,
} from '../types/zoneDelivery.types';
import type { ZoneDeliveryService } from './zoneDeliveryService';
import { deliveryError } from './zoneDeliveryErrors';

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
  if (!config || !matchesSignature(file.buffer, config.signature)
    || !file.originalFilename.toLowerCase().endsWith(config.extension)) {
    deliveryError('VALIDATION_ERROR', 'Document MIME, extension, or signature is invalid');
  }
  const safeName = sanitizeZoneDocumentFilename(file.originalFilename, file.mimeType as UploadMime);
  const before = await service.getZone(command);
  const supersededDocumentId = activeDocumentId(
    before,
    command.documentType,
    command.ponStageId,
  );
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
      const deleted = await storage.deleteFile('zone-delivery', 'documents', uploadedFilename);
      if (!deleted) {
        log.error('Zone delivery upload cleanup failed', {
          projectId: command.projectId,
          zoneNo: command.zoneNo,
          filename: uploadedFilename,
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
