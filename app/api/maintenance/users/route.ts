/**
 * Users API Route for Assignment Dropdown
 *
 * GET /api/ticketing/users - Get active users for assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getUsersForDropdown } from '@/modules/ticketing/services/teamService';

const logger = createLogger('ticketing:api:users');

/**
 * GET /api/ticketing/users
 *
 * Returns active users formatted for dropdown selection
 */
export async function GET(req: NextRequest) {
  try {
    logger.debug('Fetching users for assignment dropdown');

    const users = await getUsersForDropdown();

    return NextResponse.json({
      success: true,
      data: users,
      meta: { timestamp: new Date().toISOString(), count: users.length },
    });
  } catch (error) {
    logger.error('Error fetching users', { error });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch users' },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
