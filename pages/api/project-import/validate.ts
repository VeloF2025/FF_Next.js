/**
 * Project Import Validation API
 * PRD-047: Pre-import validation with field mapping preview
 *
 * POST /api/project-import/validate
 * Body: { projectId, dataType?, fileData (base64) }
 *
 * Returns field mappings, sample data preview, and validation issues
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '@/lib/auth-mock';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  validateImport,
  parseExcelFile,
  detectDataType,
  getMapping,
  type DataType,
  type ValidationResult,
} from '@/services/project-import';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

interface ValidateRequestBody {
  projectId: string;
  dataType?: DataType;
  fileData: string; // Base64 encoded
}

interface ValidateResponse extends ValidationResult {
  detectedDataType: DataType;
  tableName: string;
  sheetName: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  try {
    const { projectId, dataType, fileData } = req.body as ValidateRequestBody;

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

    // Parse to get headers and detect type
    let parsedData: { headers: string[]; rows: Record<string, unknown>[] };
    let sheetName = '';

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      sheetName = workbook.SheetNames[0] || '';
      parsedData = parseExcelFile(buffer);
    } catch (parseError) {
      const error = parseError as Error;
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, `Failed to parse Excel file: ${error.message}`);
    }

    // Determine data type
    let resolvedDataType = dataType;
    if (!resolvedDataType) {
      resolvedDataType = detectDataType(parsedData.headers) || undefined;
    }

    if (!resolvedDataType) {
      // Return partial validation with suggestions
      return res.status(200).json({
        valid: false,
        detectedDataType: null,
        tableName: null,
        sheetName,
        rowCount: parsedData.rows.length,
        headers: parsedData.headers,
        mappings: parsedData.headers.map(h => ({
          excelHeader: h,
          dbColumn: null,
          sampleValue: parsedData.rows[0]?.[h] ?? null,
          status: 'unmapped',
        })),
        issues: [{
          row: 0,
          field: '',
          value: null,
          message: 'Could not auto-detect data type. Headers do not match known patterns for drops, poles, or fibre.',
          severity: 'error',
        }],
        preview: parsedData.rows.slice(0, 5),
        suggestions: {
          drops: 'Expected headers: label, strtfeat, endfeat, type, spec, dim2',
          poles: 'Expected headers: label_1, type_1, spec_1, lat, lon',
          fibre: 'Expected headers: label, cable size, layer, length',
        },
      });
    }

    // Validate data
    const validation = await validateImport(buffer, resolvedDataType);
    const mapping = getMapping(resolvedDataType);

    log.info(`Validation completed`, {
      data: {
        projectId,
        dataType: resolvedDataType,
        valid: validation.valid,
        rowCount: validation.rowCount,
        mappedFields: validation.mappings.filter(m => m.status === 'mapped').length,
        issues: validation.issues.length,
      },
    }, 'project-import-api');

    const response: ValidateResponse = {
      ...validation,
      detectedDataType: resolvedDataType,
      tableName: mapping?.tableName || '',
      sheetName,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    const err = error as Error;
    log.error(`Validation failed`, {
      data: { error: err.message, stack: err.stack },
    }, 'project-import-api');

    return apiResponse.internalError(res, err);
  }
}
