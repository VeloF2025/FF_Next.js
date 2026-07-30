import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, type File as FormidableFile } from 'formidable';
import fs from 'fs';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import {
  activeDocumentId,
  documentAuditMetadata,
  storeZoneDeliveryDocument,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryDocumentStorage';
import {
  COMMAND_PERMISSIONS,
  parseDocumentBody,
  parseZoneDeliveryJson,
  ZoneDeliveryHttpError,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';

export const config = { api: { bodyParser: false } };
const service = createZoneDeliveryService(pool);
const first = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;

async function parseJson(req: NextApiRequest): Promise<unknown> {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1024 * 1024) throw new ZoneDeliveryHttpError('Invalid JSON body');
    chunks.push(buffer);
  }
  return parseZoneDeliveryJson(Buffer.concat(chunks).toString('utf8'));
}

async function parseMultipart(req: NextApiRequest) {
  const form = new IncomingForm({ maxFileSize: 50 * 1024 * 1024, maxFiles: 1 });
  const { fields, files } = await new Promise<{
    fields: Record<string, string | string[]>;
    files: Record<string, FormidableFile | FormidableFile[]>;
  }>((resolve, reject) => {
    form.parse(req, (error, parsedFields, parsedFiles) => {
      if (error) reject(new ZoneDeliveryHttpError('Invalid multipart document'));
      else resolve({
        fields: parsedFields as Record<string, string | string[]>,
        files: parsedFiles as Record<string, FormidableFile | FormidableFile[]>,
      });
    });
  });
  const file = first(files.file);
  if (!file?.filepath) throw new ZoneDeliveryHttpError('Invalid file');
  const raw = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, first(value)]),
  );
  return { file, command: parseDocumentBody({
    ...raw,
    documentSource: 'vf_storage',
    sourceRef: 'pending-upload',
    filename: file.originalFilename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    checksumSha256: '0'.repeat(64),
  }) };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return zoneDeliveryResponse(res, async () => {
    const user = (req as AuthenticatedNextApiRequest).user;
    const actor = { userId: user.id, email: user.email, permission: COMMAND_PERMISSIONS.document };
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.startsWith('application/json')) {
      const input = parseDocumentBody(await parseJson(req));
      if (input.documentSource !== 'exfo_result') {
        throw new ZoneDeliveryHttpError('Invalid documentSource');
      }
      const before = await service.getZone(input);
      const superseded = activeDocumentId(before, input.documentType, input.ponStageId);
      const zone = await service.registerDocument(input, actor);
      return {
        zone,
        document: documentAuditMetadata(input, actor, superseded),
      };
    }
    if (!contentType.startsWith('multipart/form-data')) {
      throw new ZoneDeliveryHttpError('Invalid content-type');
    }
    const { file, command } = await parseMultipart(req);
    try {
      const buffer = await fs.promises.readFile(file.filepath);
      return storeZoneDeliveryDocument({
        command,
        actor,
        file: {
          buffer,
          mimeType: file.mimetype ?? '',
          originalFilename: file.originalFilename ?? '',
        },
        service,
      });
    } finally {
      await fs.promises.unlink(file.filepath).catch((cleanupError) => {
        log.warn('Zone delivery temporary file cleanup failed', {
          path: file.filepath,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      });
    }
  });
}
export default withAuth(withPermission(COMMAND_PERMISSIONS.document, 'edit')(handler));
