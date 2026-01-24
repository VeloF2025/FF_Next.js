/**
 * Suppliers API endpoint
 * Handles GET (list) and POST (create) operations
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { NeonSupplierService } from '@/services/suppliers/neonSupplierService';
import { SupplierStatus } from '@/types/supplier/base.types';
import { log } from '@/lib/logger';

import { withAuth } from '@/lib/auth';
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    log.error('Supplier API error:', { data: error }, 'api');
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { status, isPreferred, category, search } = req.query;
    
    const filter: any = {};
    
    if (status && typeof status === 'string') {
      filter.status = status as SupplierStatus;
    }
    
    if (isPreferred !== undefined) {
      filter.isPreferred = isPreferred === 'true';
    }
    
    if (category && typeof category === 'string') {
      filter.category = category;
    }
    
    if (search && typeof search === 'string') {
      filter.searchTerm = search;
    }

    const suppliers = await NeonSupplierService.getAll(filter);
    
    return res.status(200).json({
      success: true,
      data: suppliers,
      count: suppliers.length
    });
  } catch (error) {
    log.error('Error fetching suppliers:', { data: error }, 'api');
    throw error;
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { data, userId } = req.body;
    
    if (!data || !data.name || !data.email) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['name', 'email']
      });
    }

    // TODO: Get actual userId from auth context
    const actualUserId = userId || 'system';
    
    const supplierId = await NeonSupplierService.create(data, actualUserId);
    
    return res.status(201).json({
      success: true,
      data: { id: supplierId },
      message: 'Supplier created successfully'
    });
  } catch (error) {
    log.error('Error creating supplier:', { data: error }, 'api');
    throw error;
  }
}

export default withAuth(handler);