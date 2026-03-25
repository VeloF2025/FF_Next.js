import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

/**
 * Global Search API Route
 * GET /api/search?q={query}&type={type}&limit={limit}
 *
 * Uses the PostgreSQL full-text search infrastructure we created
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const client = await pool.connect();

  try {
    const { q, type = 'all', limit = 20 } = req.query;

    if (!q || typeof q !== 'string') {
      return apiResponse.badRequest(res, 'Search query is required');
    }

    // Use the global_search function we created
    const searchResults = await client.query(
      'SELECT result_type, result_id, result_title, result_description, relevance FROM global_search($1, $2)',
      [q, parseInt(limit as string) || 20]
    );

    // Get popular searches related to this query
    const popularSearches = await client.query(`
      SELECT search_term, search_count 
      FROM popular_searches 
      WHERE search_term ILIKE $1 
      ORDER BY search_count DESC 
      LIMIT 5
    `, [`%${q}%`]);

    // Get autocomplete suggestions
    const suggestions = await client.query(`
      SELECT DISTINCT suggestion_text, suggestion_type
      FROM autocomplete_suggestions
      WHERE suggestion_text ILIKE $1
      ORDER BY usage_count DESC
      LIMIT 10
    `, [`${q}%`]);

    // Record this search in history (async, don't wait)
    client.query(`
      INSERT INTO search_history (
        user_id, search_query, search_type, 
        result_count, search_duration_ms, created_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    `, [
      req.headers['x-user-id'] || null,
      q,
      type as string,
      searchResults.rows.length,
      50 // You could measure actual duration
    ]).catch(err => log.error('Failed to record search', { error: err }));

    // Update popular searches count
    client.query(`
      INSERT INTO popular_searches (search_term, search_count, category, last_searched)
      VALUES ($1, 1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (search_term, category) 
      DO UPDATE SET 
        search_count = popular_searches.search_count + 1,
        last_searched = CURRENT_TIMESTAMP
    `, [q, type]).catch(err => log.error('Failed to update popular searches', { error: err }));

    // Format response
    const response = {
      success: true,
      query: q,
      results: searchResults.rows.map(row => ({
        type: row.result_type,
        id: row.result_id,
        title: row.result_title,
        description: row.result_description || '',
        relevance: row.relevance
      })),
      suggestions: suggestions.rows.map(s => s.suggestion_text),
      popular: popularSearches.rows.map(p => p.search_term),
      total: searchResults.rows.length
    };

    return res.status(200).json(response);

  } catch (error) {
    log.error('Search error', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Search failed'
    });
  } finally {
    client.release();
  }
}

export default withAuth(handler);