/**
 * GET /api/qfield/photo-proxy?key={photo_key}
 * Proxy photos from MinIO (QFieldCloud storage) to frontend
 *
 * Fetches photos from the qfieldcloud-prod bucket on Velocity (100.96.203.105:8009)
 * using AWS S3-compatible authentication and serves them to the frontend.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import crypto from 'crypto';

// MinIO configuration - port 8009 is the external mapping for internal 9000
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://100.96.203.105:8009';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'qfieldcloud-prod';
const MINIO_REGION = process.env.MINIO_REGION || 'us-east-1';

/**
 * Generate AWS Signature Version 4 for MinIO authentication
 */
function generateAwsSignatureV4(
  method: string,
  host: string,
  path: string,
  accessKey: string,
  secretKey: string,
  region: string,
  service: string = 's3'
): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  // Create canonical request
  const canonicalUri = path;
  const canonicalQueryString = '';
  const payloadHash = crypto.createHash('sha256').update('').digest('hex');
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Calculate signature
  const getSignatureKey = (key: string, dateStamp: string, regionName: string, serviceName: string) => {
    const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  };

  const signingKey = getSignatureKey(secretKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  // Create authorization header
  const authorization = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'Authorization': authorization,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { key } = req.query;

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Photo key parameter required' });
  }

  try {
    // Construct MinIO URL
    // Key format: projects/{project_id}/files/DCIM/{filename}/{version}
    const objectPath = key.startsWith('/') ? key.slice(1) : key;

    // Parse endpoint to get host
    const endpointUrl = new URL(MINIO_ENDPOINT);
    const host = endpointUrl.host;
    const path = `/${MINIO_BUCKET}/${objectPath}`;
    const minioUrl = `${MINIO_ENDPOINT}${path}`;

    log.debug('qfield-photo-proxy', { key: objectPath, url: minioUrl }, 'Fetching photo');

    // Generate AWS Signature V4 headers
    const authHeaders = generateAwsSignatureV4(
      'GET',
      host,
      path,
      MINIO_ACCESS_KEY,
      MINIO_SECRET_KEY,
      MINIO_REGION
    );

    // Fetch from MinIO with authentication
    const response = await fetch(minioUrl, {
      headers: {
        ...authHeaders,
        'Host': host,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('qfield-photo-proxy', {
        key: objectPath,
        status: response.status,
        error: errorText.slice(0, 200)
      }, 'MinIO fetch failed');

      // Return placeholder for missing photos
      if (response.status === 404) {
        return res.status(404).json({
          error: 'Photo not found',
          key: objectPath,
        });
      }

      return res.status(response.status).json({
        error: `Failed to fetch photo: ${response.statusText}`,
      });
    }

    // Get image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Set headers for caching and CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    // Send image
    res.send(Buffer.from(imageBuffer));
  } catch (error) {
    log.error('qfield-photo-proxy', error instanceof Error ? { message: error.message } : { error }, 'Proxy error');
    return res.status(500).json({
      error: 'Failed to proxy photo',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(handler);
