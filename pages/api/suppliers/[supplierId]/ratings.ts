/**
 * Supplier Ratings API endpoint
 * Handles rating operations for specific suppliers
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { NeonSupplierService } from '@/services/suppliers/neonSupplierService';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { supplierId: id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Invalid supplier ID');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, res);
      case 'POST':
        return handlePost(id, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
    }
  } catch (error) {
    log.error(`Supplier ratings API error for ${id}:`, { data: error }, 'api');
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  try {
    // Get all ratings for the supplier
    const ratings = await sql`
      SELECT 
        r.*,
        r.created_by_name as reviewer_name
      FROM supplier_ratings r
      WHERE r.supplier_id = ${parseInt(id)}
      ORDER BY r.created_at DESC
    `;

    // Get average ratings
    const avgResult = await sql`
      SELECT 
        AVG(overall_rating) as avg_overall,
        AVG(quality_rating) as avg_quality,
        AVG(delivery_rating) as avg_delivery,
        AVG(pricing_rating) as avg_pricing,
        AVG(communication_rating) as avg_communication,
        AVG(flexibility_rating) as avg_flexibility,
        COUNT(*) as total_reviews
      FROM supplier_ratings
      WHERE supplier_id = ${parseInt(id)}
    `;

    const statistics = avgResult[0];

    return res.status(200).json({
      success: true,
      data: {
        ratings,
        statistics: {
          averageOverall: parseFloat(statistics.avg_overall || 0),
          averageQuality: parseFloat(statistics.avg_quality || 0),
          averageDelivery: parseFloat(statistics.avg_delivery || 0),
          averagePricing: parseFloat(statistics.avg_pricing || 0),
          averageCommunication: parseFloat(statistics.avg_communication || 0),
          averageFlexibility: parseFloat(statistics.avg_flexibility || 0),
          totalReviews: parseInt(statistics.total_reviews || 0)
        }
      }
    });
  } catch (error) {
    log.error(`Error fetching ratings for supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

async function handlePost(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { rating, reviewTitle, reviewText } = req.body;
    
    if (!rating || !rating.overall) {
      return res.status(400).json({
        error: 'Missing required rating data',
        required: ['rating.overall']
      });
    }

    // Validate rating values (0-5 scale)
    const ratingFields = ['overall', 'quality', 'delivery', 'pricing', 'communication', 'flexibility'];
    for (const field of ratingFields) {
      if (rating[field] !== undefined && (rating[field] < 0 || rating[field] > 5)) {
        return res.status(400).json({
          error: `Invalid ${field} rating. Must be between 0 and 5`,
          field,
          value: rating[field]
        });
      }
    }

    const actualUserId = (req as any).user?.id || 'system';
    const actualUserName = (req as any).user?.name || 'Anonymous';

    // Add the rating
    await sql`
      INSERT INTO supplier_ratings (
        supplier_id,
        overall_rating,
        quality_rating,
        delivery_rating,
        pricing_rating,
        communication_rating,
        flexibility_rating,
        review_title,
        review_text,
        created_by,
        created_by_name
      ) VALUES (
        ${parseInt(id)},
        ${rating.overall},
        ${rating.quality || null},
        ${rating.delivery || null},
        ${rating.pricing || null},
        ${rating.communication || null},
        ${rating.flexibility || null},
        ${reviewTitle || null},
        ${reviewText || null},
        ${actualUserId},
        ${actualUserName}
      )
    `;

    // Update supplier's average ratings
    await NeonSupplierService.updateRating(id, rating, actualUserId);
    
    return res.status(201).json({
      success: true,
      message: 'Rating added successfully'
    });
  } catch (error) {
    log.error(`Error adding rating for supplier ${id}:`, { data: error }, 'api');
    throw error;
  }
}

export default withAuth(handler);