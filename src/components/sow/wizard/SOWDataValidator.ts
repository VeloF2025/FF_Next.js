/**
 * SOW Upload Data Validation Logic
 *
 * Expected Column Names for Different Data Types:
 *
 * POLES:
 * - pole_number (or pole number, pole_id, pole id, pole_no, pole#, etc.)
 * - latitude (or lat, coord_lat)
 * - longitude (or lng, long, coord_lng)
 * - max_drops (optional, or capacity, max_capacity)
 * - status (optional)
 *
 * DROPS:
 * - drop_number (or drop number, drop_id, drop id, drop_no, drop#, etc.)
 * - pole_number (or pole number, pole_id, pole id, pole_no, etc.)
 * - address (or installation_address, location)
 * - status (optional)
 *
 * FIBRE:
 * - segment_id (or segment id, cable_id, cable id)
 * - from_point (or from point, start_point, start point)
 * - to_point (or to point, end_point, end point)
 * - distance (or length, cable_length, metres, meters)
 * - cable_type (optional, or type)
 * - status (optional)
 */

interface ValidationResult { isValid: boolean; error?: string; processedData?: unknown; }
import { sowApi } from '@/services/api/sowApi';
import { NeonPoleData, NeonDropData, NeonFibreData } from '@/services/sow/types';
import { log } from '@/lib/logger';

export const validateStepData = (stepType: string, data: Record<string, unknown>[]): ValidationResult => {
  if (!data || data.length === 0) {
    return { isValid: false, error: 'File is empty or invalid format' };
  }

  switch (stepType) {
    case 'poles':
      return validatePolesData(data);
    case 'drops':
      return validateDropsData(data);
    case 'fibre':
      return validateFibreData(data);
    default:
      return { isValid: false, error: 'Unknown step type' };
  }
};

const validatePolesData = (data: Record<string, unknown>[]): ValidationResult => {
  const requiredFields = ['pole_number', 'latitude', 'longitude'];
  const firstRow = data[0];

  if (!firstRow) {
    return { isValid: false, error: 'File appears to be empty or has no data rows' };
  }

  // Log original columns for debugging
  log.debug('Original columns from Excel:', { columns: Object.keys(firstRow) }, 'SOWDataValidator');

  const availableColumns = Object.keys(firstRow).map(key => key.toLowerCase().trim());
  log.debug('Normalized columns:', { columns: availableColumns }, 'SOWDataValidator');

  const missingFields = requiredFields.filter(field => {
    // Special handling for each required field with more variants
    if (field === 'pole_number') {
      // Check for label_1, label, pole_number, etc.
      return !availableColumns.some(col => 
        col === 'label_1' || 
        col === 'label' ||
        col.includes('pole') ||
        col.includes('pole_number') ||
        col.includes('pole number')
      );
    } else if (field === 'latitude') {
      // Check for lat, latitude, etc.
      return !availableColumns.some(col => 
        col === 'lat' ||
        col.includes('latitude') ||
        col.includes('coord_lat')
      );
    } else if (field === 'longitude') {
      // Check for lon, lng, longitude, etc.
      return !availableColumns.some(col => 
        col === 'lon' ||
        col === 'lng' ||
        col.includes('longitude') ||
        col.includes('coord_lng')
      );
    }
    
    const fieldVariants = [
      field,
      field.replace('_', ''),
      field.replace('_', ' '),
      field.replace('_', '-'),
      field.replace('_', '.')
    ];

    return !fieldVariants.some(variant =>
      availableColumns.some(col => col.includes(variant.toLowerCase()))
    );
  });

  if (missingFields.length > 0) {
    const suggestions = {
      pole_number: 'Try: label_1, label, pole_number, pole_no, pole#, pole_id, pole number',
      latitude: 'Try: lat, latitude, coord_lat',
      longitude: 'Try: lon, lng, longitude, long, coord_lng'
    };

    const suggestionText = missingFields.map(field =>
      `${field} (${suggestions[field as keyof typeof suggestions] || 'check column headers'})`
    ).join('; ');

    return {
      isValid: false,
      error: `Missing required columns for poles: ${missingFields.join(', ')}. ${suggestionText}. Available columns: ${availableColumns.join(', ')}`
    };
  }

  const processedData = data.map(row => ({
    pole_number: findColumnValue(row, ['label_1', 'label', 'pole_number', 'pole number', 'pole_id', 'pole id']),
    latitude: parseFloat(findColumnValue(row, ['lat', 'latitude', 'coord_lat'])) || 0,
    longitude: parseFloat(findColumnValue(row, ['lon', 'lng', 'longitude', 'long', 'coord_lng'])) || 0,
    max_drops: parseInt(findColumnValue(row, ['max_drops', 'capacity', 'max_capacity'])) || 12,
    current_drops: 0,
    status: findColumnValue(row, ['status']) || 'planned'
  })).filter(item => item.pole_number);

  return { isValid: true, processedData };
};

const validateDropsData = (data: Record<string, unknown>[]): ValidationResult => {
  const firstRow = data[0];

  if (!firstRow) {
    return { isValid: false, error: 'File appears to be empty or has no data rows' };
  }

  const availableColumns = Object.keys(firstRow).map(key => key.toLowerCase().trim());

  // Check for Lawley format (label, strtfeat, endfeat)
  const isLawleyFormat = availableColumns.includes('label') && 
                          availableColumns.includes('strtfeat') && 
                          availableColumns.includes('endfeat');

  if (isLawleyFormat) {
    // Process Lawley format
    const processedData = data.map(row => ({
      drop_number: findColumnValue(row, ['label', 'drop_number', 'drop number', 'drop_id']),
      pole_number: findColumnValue(row, ['strtfeat', 'pole_number', 'pole number', 'pole_id']),
      address: findColumnValue(row, ['endfeat', 'address', 'installation_address', 'location']) || 
               findColumnValue(row, ['comments', 'notes']) || '',
      cable_length: findColumnValue(row, ['dim2', 'length', 'distance']) || '',
      status: findColumnValue(row, ['status']) || 'planned',
      metadata: {
        type: findColumnValue(row, ['type']),
        subtype: findColumnValue(row, ['subtyp']),
        spec: findColumnValue(row, ['spec']),
        capacity: findColumnValue(row, ['cblcpty']),
        pon_no: findColumnValue(row, ['pon_no']),
        zone_no: findColumnValue(row, ['zone_no']),
        municipality: findColumnValue(row, ['mun']),
        created_date: findColumnValue(row, ['datecrtd']),
        created_by: findColumnValue(row, ['crtdby'])
      }
    })).filter(item => item.drop_number);

    log.info(`Processed ${processedData.length} drops in Lawley format`, {}, 'SOWDataValidator');
    return { isValid: true, processedData };
  }

  // Try standard format validation
  const requiredFields = ['drop_number', 'pole_number'];
  const missingFields = requiredFields.filter(field => {
    const fieldVariants = [
      field,
      field.replace('_', ''),
      field.replace('_', ' '),
      field.replace('_', '-'),
      field.replace('_', '.')
    ];

    return !fieldVariants.some(variant =>
      availableColumns.some(col => col.includes(variant.toLowerCase()))
    );
  });

  if (missingFields.length > 0) {
    const suggestions = {
      drop_number: 'Try: label, drop_number, drop_no, drop#, drop_id, drop number',
      pole_number: 'Try: strtfeat, pole_number, pole_no, pole#, pole_id, pole number'
    };

    const suggestionText = missingFields.map(field =>
      `${field} (${suggestions[field as keyof typeof suggestions] || 'check column headers'})`
    ).join('; ');

    return {
      isValid: false,
      error: `Missing required columns for drops: ${missingFields.join(', ')}. ${suggestionText}. Available columns: ${availableColumns.join(', ')}`
    };
  }

  const processedData = data.map(row => ({
    drop_number: findColumnValue(row, ['drop_number', 'drop number', 'drop_id', 'drop id', 'label']),
    pole_number: findColumnValue(row, ['pole_number', 'pole number', 'pole_id', 'pole id', 'strtfeat']),
    address: findColumnValue(row, ['address', 'installation_address', 'location', 'endfeat']) || '',
    status: findColumnValue(row, ['status']) || 'planned'
  })).filter(item => item.drop_number);

  return { isValid: true, processedData };
};

const validateFibreData = (data: Record<string, unknown>[]): ValidationResult => {
  const firstRow = data[0];

  if (!firstRow) {
    return { isValid: false, error: 'File appears to be empty or has no data rows' };
  }

  const availableColumns = Object.keys(firstRow).map(key => key.toLowerCase().trim());

  // Check for Lawley format (label, cable size, length)
  const isLawleyFormat = availableColumns.includes('label') && 
                          availableColumns.includes('length') && 
                          availableColumns.includes('cable size');

  if (isLawleyFormat) {
    // Process Lawley format
    const processedData = data.map(row => {
      const label = findColumnValue(row, ['label', 'segment_id']);
      // Extract from/to points from label (format: LAW.PF.96F.MH.A001-MH.A109)
      let fromPoint = '';
      let toPoint = '';
      if (label && label.includes('-')) {
        const parts = label.split('-');
        fromPoint = parts[0]!.split('.').slice(-1)[0] ?? ''; // Get last part before dash
        toPoint = parts[1] ?? ''; // Everything after dash
      }
      
      return {
        segment_id: label,
        from_point: fromPoint,
        to_point: toPoint,
        distance: parseFloat(findColumnValue(row, ['length', 'distance'])) || 0,
        cable_type: findColumnValue(row, ['cable size', 'cable_size']) || 'standard',
        cable_size: findColumnValue(row, ['cable size', 'cable_size']) || '',
        layer: findColumnValue(row, ['layer']) || '',
        pon_no: parseInt(findColumnValue(row, ['pon_no'])) || 0,
        zone_no: parseInt(findColumnValue(row, ['zone_no'])) || 0,
        contractor: findColumnValue(row, ['contractor', 'Contractor']) || '',
        complete: findColumnValue(row, ['complete', 'Complete']) || '',
        status: findColumnValue(row, ['complete', 'Complete']) === 'Yes' ? 'completed' : 'planned',
        metadata: {
          string_completed: findColumnValue(row, ['String Com']),
          date_completed: findColumnValue(row, ['Date Comp'])
        }
      };
    }).filter(item => item.segment_id && item.distance >= 0);

    log.info(`Processed ${processedData.length} fibre segments in Lawley format`, {}, 'SOWDataValidator');
    return { isValid: true, processedData };
  }

  // Try standard format validation
  const requiredFields = ['segment_id', 'distance'];
  const missingFields = requiredFields.filter(field => {
    const fieldVariants = [
      field,
      field.replace('_', ''),
      field.replace('_', ' '),
      field.replace('_', '-'),
      field.replace('_', '.')
    ];

    return !fieldVariants.some(variant =>
      availableColumns.some(col => col.includes(variant.toLowerCase()))
    );
  });

  if (missingFields.length > 0) {
    const suggestions = {
      segment_id: 'Try: label, segment_id, segment id, cable_id, cable id',
      distance: 'Try: length, distance, cable_length, metres, meters'
    };

    const suggestionText = missingFields.map(field =>
      `${field} (${suggestions[field as keyof typeof suggestions] || 'check column headers'})`
    ).join('; ');

    return {
      isValid: false,
      error: `Missing required columns for fibre: ${missingFields.join(', ')}. ${suggestionText}. Available columns: ${availableColumns.join(', ')}`
    };
  }

  const processedData = data.map(row => ({
    segment_id: findColumnValue(row, ['segment_id', 'segment id', 'cable_id', 'cable id', 'label']),
    from_point: findColumnValue(row, ['from_point', 'from point', 'start_point', 'start point']) || '',
    to_point: findColumnValue(row, ['to_point', 'to point', 'end_point', 'end point']) || '',
    distance: parseFloat(findColumnValue(row, ['distance', 'length', 'cable_length', 'metres', 'meters'])) || 0,
    cable_type: findColumnValue(row, ['cable_type', 'type', 'cable size']) || 'standard',
    status: findColumnValue(row, ['status']) || 'planned'
  })).filter(item => item.segment_id);

  return { isValid: true, processedData };
};

const findColumnValue = (row: Record<string, unknown>, possibleColumns: string[]): string => {
  for (const col of possibleColumns) {
    // Create multiple variations of the column name to match
    const variations = [
      col,
      col.replace(/_/g, ""),
      col.replace(/_/g, " "),
      col.replace(/_/g, "-"),
      col.replace(/_/g, "."),
      col.replace(/number/g, "no"),
      col.replace(/number/g, "num"),
      col.replace(/number/g, "#"),
      col.replace(/latitude/g, "lat"),
      col.replace(/longitude/g, "lng"),
      col.replace(/longitude/g, "long")
    ];

    for (const variant of variations) {
      const key = Object.keys(row).find(k =>
        k.toLowerCase().replace(/[_\s-.]/g, "") === variant.toLowerCase().replace(/[_\s-.]/g, "")
      );
      if (key && row[key] !== undefined && row[key] !== null && row[key] !== "") {
        return String(row[key]).trim();
      }
    }
  }
  return "";
};

export const processStepData = async (projectId: string, stepType: string, data: Record<string, unknown>[]) => {
  try {
    // Initialize tables first (idempotent operation)
    const initResult = await sowApi.initializeTables(projectId);
    if (!initResult.success) {
      throw new Error('Failed to initialize database tables');
    }

    // Upload data based on step type (data is validated and shaped by validate*Data above)
    let result;
    switch (stepType) {
      case 'poles':
        result = await sowApi.uploadPoles(projectId, data as unknown as NeonPoleData[]);
        break;
      case 'drops':
        result = await sowApi.uploadDrops(projectId, data as unknown as NeonDropData[]);
        break;
      case 'fibre':
        result = await sowApi.uploadFibre(projectId, data as unknown as NeonFibreData[]);
        break;
      default:
        throw new Error(`Unknown step type: ${stepType}`);
    }
    
    // Check if the result indicates success
    if (!result.success) {
      throw new Error(result.error || 'Failed to save data to database');
    }
    
    return result;
  } catch (error) {
    log.error('Error uploading SOW data', { error, projectId, stepType, dataLength: data.length }, 'SOWDataValidator');
    // DO NOT fallback to localStorage - throw the error instead
    throw new Error(`Failed to save ${stepType} data: ${error instanceof Error ? error.message : String(error)}`);
  }
};