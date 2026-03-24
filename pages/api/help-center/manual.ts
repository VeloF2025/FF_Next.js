import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const manualPath = path.join(process.cwd(), 'docs/user-manuals/source/fibreflow-complete.md');
    const content = fs.readFileSync(manualPath, 'utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json({ content });
  } catch (error) {
    log.error('help-center-manual GET', { error: error instanceof Error ? error.message : String(error) });
    apiResponse.internalError(res, new Error('Failed to load manual'));
  }
}
