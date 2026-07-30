import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, type File as FormidableFile } from 'formidable';
import fs from 'fs';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import {
  storeZoneDeliveryDocument,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryDocumentStorage';
import {
  COMMAND_PERMISSIONS,
  parseDocumentBody,
  parseZoneDeliveryJson,
  ZoneDeliveryHttpError,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';
import { deliveryError } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryErrors';

export const config = { api: { bodyParser: false } };
const service = createZoneDeliveryService(pool);
const first = <T>(value: T | T[] | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value;
const filesFrom = (files: Record<string, FormidableFile | FormidableFile[]>): FormidableFile[] =>
  Object.values(files).flatMap((value) => Array.isArray(value) ? value : [value]);
async function cleanupTempFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map(path => fs.promises.unlink(path).catch((cleanupError) => {
    log.warn('Zone delivery temporary file cleanup failed', {
      path,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  })));
}

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
  const { error, fields, files } = await new Promise<{
    error: unknown;
    fields: Record<string, string | string[]>;
    files: Record<string, FormidableFile | FormidableFile[]>;
  }>((resolve) => {
    form.parse(req, (error, parsedFields, parsedFiles) => {
      resolve({
        error,
        fields: parsedFields as Record<string, string | string[]>,
        files: parsedFiles as Record<string, FormidableFile | FormidableFile[]>,
      });
    });
  });
  const tempPaths = filesFrom(files).map(file => file.filepath).filter(Boolean);
  if (error) {
    await cleanupTempFiles(tempPaths);
    throw new ZoneDeliveryHttpError('Invalid multipart document');
  }
  const file = first(files.file);
  try {
    if (!file?.filepath) throw new ZoneDeliveryHttpError('Invalid file');
    const raw = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, first(value)]),
    );
    return { file, tempPaths, command: parseDocumentBody({
      ...raw,
      documentSource: 'vf_storage',
      sourceRef: 'pending-upload',
      filename: file.originalFilename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksumSha256: '0'.repeat(64),
    }, { coerceCommandNumbers: true }) };
  } catch (validationError) {
    await cleanupTempFiles(tempPaths);
    log.warn('Zone delivery multipart validation failed', {
      error: validationError instanceof Error ? validationError.message : String(validationError),
    });
    throw validationError;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return zoneDeliveryResponse(res, async () => {
    const user = (req as AuthenticatedNextApiRequest).user;
    const actor = { userId: user.id, email: user.email, permission: COMMAND_PERMISSIONS.document };
    const mediaType = (req.headers['content-type'] ?? '').split(';', 1)[0]!.trim().toLowerCase();
    if (mediaType === 'application/json') {
      const input = parseDocumentBody(await parseJson(req));
      if (input.documentSource === 'exfo_result') {
        deliveryError(
          'EVIDENCE_REQUIRED',
          'EXFO evidence requires canonical project, zone and PON mapping; upload a supervised test pack instead',
        );
      } else {
        throw new ZoneDeliveryHttpError('Invalid documentSource');
      }
    }
    if (mediaType !== 'multipart/form-data') {
      throw new ZoneDeliveryHttpError('Invalid content-type');
    }
    const { file, command, tempPaths } = await parseMultipart(req);
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
      await cleanupTempFiles(tempPaths);
    }
  });
}
export default withAuth(withPermission(COMMAND_PERMISSIONS.document, 'edit')(handler));
