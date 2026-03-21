/**
 * Unified Project Import API
 * PRD-047: Main import endpoint for drops, poles, and fibre data
 *
 * POST /api/project-import
 * Body: { projectId, dataType, fileData (base64), options? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  importData,
  parseExcelFile,
  detectDataType,
  type DataType,
  type ImportOptions,
  type ImportResult,
} from '@/services/project-import';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb', // Support large Excel files
    },
  },
};

interface ImportRequestBody {
  projectId: string;
  dataType?: DataType;
  fileData: string; // Base64 encoded
  options?: ImportOptions;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
    const userId = (req as AuthenticatedNextApiRequest).user.id;
  try {
    const { projectId, dataType, fileData, options } = req.body as ImportRequestBody;

    // Validate required fields
    if (!projectId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'projectId is required');
    }

    if (!fileData) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'fileData (base64 encoded Excel file) is required');
    }

    // Decode base64 to buffer
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileData, 'base64');
    } catch {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid base64 fileData');
    }

    // Auto-detect data type if not provided
    let resolvedDataType = dataType;
    if (!resolvedDataType) {
      try {
        const { headers } = parseExcelFile(buffer);
        resolvedDataType = detectDataType(headers) || undefined;

        if (!resolvedDataType) {
          return apiResponse.error(
            res,
            ErrorCode.BAD_REQUEST,
            'Could not auto-detect data type. Please specify dataType: "drops", "poles", or "fibre"'
          );
        }

        log.info(`Auto-detected data type: ${resolvedDataType}`, {}, 'project-import-api');
      } catch (parseError) {
        log.error('project-import-index', { error: parseError instanceof Error ? parseError.message : String(parseError) });
        const error = parseError as Error;
        return apiResponse.error(res, ErrorCode.BAD_REQUEST, `Failed to parse Excel file: ${error.message}`);
      }
    }

    // Validate data type
    if (!['drops', 'poles', 'fibre'].includes(resolvedDataType)) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        `Invalid dataType: ${resolvedDataType}. Must be "drops", "poles", or "fibre"`
      );
    }

    log.info(`Starting import`, {
      data: {
        projectId,
        dataType: resolvedDataType,
        options,
        userId,
      },
    }, 'project-import-api');

    // Perform import
    const result: ImportResult = await importData(
      buffer,
      projectId,
      resolvedDataType,
      options || {}
    );

    log.info(`Import completed`, {
      data: {
        projectId,
        dataType: resolvedDataType,
        success: result.success,
        stats: result.stats,
        duration: result.duration,
      },
    }, 'project-import-api');

    // Return result
    const { success: importSuccess, ...resultData } = result;

    if (importSuccess) {
      return apiResponse.success(res, {
        message: `Successfully imported ${result.stats.imported} ${resolvedDataType}`,
        importSuccess,
        ...resultData,
      });
    } else {
      return res.status(207).json({
        success: false,
        message: `Import completed with ${result.stats.errors} errors`,
        importSuccess,
        ...resultData,
      });
    }
  } catch (error) {
    const err = error as Error;
    log.error(`Import failed`, {
      data: { error: err.message, stack: err.stack },
    }, 'project-import-api');

    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
