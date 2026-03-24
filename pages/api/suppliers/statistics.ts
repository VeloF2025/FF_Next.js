/**
 * Suppliers Statistics API endpoint
 * Returns aggregate statistics for suppliers
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { NeonSupplierService } from '@/services/suppliers/neonSupplierService';
import { log } from '@/lib/logger';

import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== 'GET') {
      return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
    }

    // Get all suppliers to calculate statistics
    const suppliers = await NeonSupplierService.getAll();
    
    // Calculate statistics
    const stats = {
      total: suppliers.length,
      active: suppliers.filter(s => s.status === 'ACTIVE').length,
      preferred: suppliers.filter(s => s.isPreferred).length,
      averageRating: suppliers.length > 0
        ? suppliers.reduce((sum, s) => {
            const rating = typeof s.rating === 'object' ? s.rating?.overall : s.rating;
            return sum + (rating || 0);
          }, 0) / suppliers.length
        : 0,
      byStatus: suppliers.reduce((acc, supplier) => {
        acc[supplier.status] = (acc[supplier.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byCategory: suppliers.reduce((acc, supplier) => {
        if (supplier.categories) {
          supplier.categories.forEach(category => {
            acc[category] = (acc[category] || 0) + 1;
          });
        }
        return acc;
      }, {} as Record<string, number>)
    };
    
    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    log.error('Error fetching supplier statistics:', { data: error }, 'api');
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default withAuth(handler);