/**
 * QA Photo Local Storage Service
 *
 * Copies photos from MinIO (QField) or SharePoint to local disk storage
 * at /home/velo/storage/qa-photos/ for fast serving without API calls.
 *
 * Used by ingestion pipelines to ensure new photos are immediately
 * available from local disk across all environments.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);
const STORAGE_ROOT = process.env.QA_PHOTO_STORAGE || '/home/velo/storage/qa-photos';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';
const MODULE = 'qa-photo-storage';

// Project UUID → slug cache
const projectSlugCache = new Map<string, string>();

/**
 * Get a filesystem-safe project slug from its UUID.
 * Caches lookups to avoid repeated DB queries.
 */
async function getProjectSlug(projectId: string): Promise<string> {
  if (projectSlugCache.has(projectId)) {
    return projectSlugCache.get(projectId)!;
  }

  const rows = await sql`
    SELECT project_name FROM projects WHERE id = ${projectId}::uuid LIMIT 1
  `;

  const name = rows[0]?.project_name as string || projectId;
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  projectSlugCache.set(projectId, slug);
  return slug;
}

/**
 * Sanitize a filename for filesystem use.
 */
function sanitize(name: string): string {
  return name.replace(/[<>:"|?*]/g, '_');
}

/**
 * Build the local storage relative path for a photo.
 */
async function buildLocalPath(
  projectId: string,
  featureId: string,
  filename: string,
): Promise<string> {
  const projectSlug = await getProjectSlug(projectId);
  const safeFeature = sanitize(featureId);
  const safeFilename = sanitize(filename);
  return `${projectSlug}/${safeFeature}/${safeFilename}`;
}

/**
 * Copy a QField photo from MinIO to local storage.
 *
 * @returns The relative storage path if successful, null on failure.
 *          On failure, the caller should fall back to source='qfield'.
 */
export async function copyQFieldPhotoToStorage(
  minioKey: string,
  projectId: string,
  featureId: string,
  filename: string,
): Promise<string | null> {
  try {
    const relPath = await buildLocalPath(projectId, featureId, filename);
    const destPath = path.join(STORAGE_ROOT, relPath);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
      return relPath;
    }

    // Ensure directory
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    // Copy from MinIO
    const objectPath = minioKey.startsWith('/') ? minioKey.slice(1) : minioKey;
    const mcPath = `local/${MINIO_BUCKET}/${objectPath}`;
    const escapedPath = mcPath.replace(/'/g, "'\\''");

    const buffer = execSync(`docker exec qfieldcloud-minio-1 mc cat '${escapedPath}'`, {
      maxBuffer: 50 * 1024 * 1024,
    });

    if (buffer.length < 100) {
      log.warn('MinIO photo too small, skipping local copy', { minioKey, size: buffer.length }, MODULE);
      return null;
    }

    fs.writeFileSync(destPath, buffer);
    return relPath;
  } catch (err) {
    log.warn('Failed to copy QField photo to local storage', {
      minioKey,
      error: (err as Error).message.slice(0, 100),
    }, MODULE);
    return null;
  }
}

/**
 * Download a SharePoint photo to local storage.
 *
 * @param graphUrl - Full MS Graph API URL for the photo content
 * @param token - Valid MS Graph bearer token
 * @returns The relative storage path if successful, null on failure.
 */
export async function downloadSharePointPhotoToStorage(
  graphUrl: string,
  token: string,
  projectId: string,
  featureId: string,
  filename: string,
): Promise<string | null> {
  try {
    const relPath = await buildLocalPath(projectId, featureId, filename);
    const destPath = path.join(STORAGE_ROOT, relPath);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
      return relPath;
    }

    // Ensure directory
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    let url = graphUrl;
    if (!url.endsWith('/content')) url += '/content';

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });

    if (!res.ok) {
      log.warn('SharePoint download failed', { status: res.status, graphUrl }, MODULE);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      log.warn('SharePoint photo too small', { graphUrl, size: buffer.length }, MODULE);
      return null;
    }

    fs.writeFileSync(destPath, buffer);
    return relPath;
  } catch (err) {
    log.warn('Failed to download SharePoint photo to local storage', {
      graphUrl,
      error: (err as Error).message.slice(0, 100),
    }, MODULE);
    return null;
  }
}
