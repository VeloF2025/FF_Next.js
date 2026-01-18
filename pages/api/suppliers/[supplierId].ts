/**
 * Individual Supplier API endpoint
 * Handles GET (read), PUT (update), and DELETE operations
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { NeonSupplierService } from '@/services/suppliers/neonSupplierService';
import { log } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { supplierId: id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid supplier ID' });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, res);
      case 'PUT':
        return handlePut(id, req, res);
      case 'DELETE':
        return handleDelete(id, req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    log.error(`Supplier API error for ${id}:`, { data: error }, 'api');
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  try {
    const supplier = await NeonSupplierService.getById(id);
    
    if (!supplier) {
      return res.status(404).json({
        error: 'Supplier not found',
        id
      });
    }
    
    return res.status(200).json({
      success: true,
      data: supplier
    });
  } catch (error) {
    log.error(`Error fetching supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

async function handlePut(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { data, userId } = req.body;
    
    if (!data) {
      return res.status(400).json({
        error: 'Missing update data'
      });
    }

    // Check if supplier exists
    const existing = await NeonSupplierService.getById(id);
    if (!existing) {
      return res.status(404).json({
        error: 'Supplier not found',
        id
      });
    }

    // TODO: Get actual userId from auth context
    const actualUserId = userId || 'system';
    
    await NeonSupplierService.update(id, data, actualUserId);
    
    return res.status(200).json({
      success: true,
      message: 'Supplier updated successfully'
    });
  } catch (error) {
    log.error(`Error updating supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

async function handleDelete(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { soft, reason, userId } = req.body;

    // Check if supplier exists
    const existing = await NeonSupplierService.getById(id);
    if (!existing) {
      return res.status(404).json({
        error: 'Supplier not found',
        id
      });
    }

    if (soft) {
      // Soft delete (deactivate)
      const actualUserId = userId || 'system';
      await NeonSupplierService.softDelete(id, reason || 'Deactivated via API', actualUserId);
    } else {
      // Check for dependencies before hard delete
      const deps = await NeonSupplierService.checkDependencies(id);

      if (deps.hasDependencies) {
        return res.status(409).json({
          error: 'Cannot delete supplier with dependencies',
          message: deps.message,
          dependencies: {
            purchaseOrders: deps.purchaseOrders,
            rfqs: deps.rfqs,
            boqItems: deps.boqItems
          },
          suggestion: 'Use soft delete (deactivate) instead, or remove the related records first.'
        });
      }

      // Hard delete - no dependencies
      await NeonSupplierService.delete(id);
    }

    return res.status(200).json({
      success: true,
      message: soft ? 'Supplier deactivated successfully' : 'Supplier deleted successfully'
    });
  } catch (error) {
    log.error(`Error deleting supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}