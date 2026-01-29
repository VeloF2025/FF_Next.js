/**
 * QField OES Sync API
 * POST /api/qfield/oes-sync
 * Executes OES sync script on VPS and streams output
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { spawn } from 'child_process';
import { log } from '@/lib/logger';

// VPS Configuration - Updated Jan 2026 to use Velocity Server
const VPS_HOST = process.env.VPS_HOST || '100.96.203.105';
const VPS_USER = process.env.VPS_USER || 'velo';
const VPS_OES_PATH = process.env.VPS_OES_PATH || '/opt/qfield-sync';
const SSH_KEY_PATH = process.env.VPS_SSH_KEY_PATH || '/home/velo/.ssh/id_rsa';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract projectId from request body
    const { projectId } = req.body;

    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId is required' });
    }

    log.info('api/qfield/oes-sync', { action: 'startSync', projectId });

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // SSH command to execute sync script with project ID
    const sshCommand = [
      '-i', SSH_KEY_PATH,
      '-o', 'StrictHostKeyChecking=no',
      `${VPS_USER}@${VPS_HOST}`,
      `cd ${VPS_OES_PATH}/scripts && QFIELD_PROJECT_ID=${projectId} ./run_oes_sync.sh 2>&1`
    ];

    const ssh = spawn('ssh', sshCommand);

    let hasError = false;
    let fullOutput = '';

    // Send start event
    res.write(`data: ${JSON.stringify({ type: 'start', timestamp: new Date().toISOString() })}\n\n`);

    // Stream stdout
    ssh.stdout.on('data', (data) => {
      const output = data.toString();
      fullOutput += output;

      // Split by newlines and send each line
      const lines = output.split('\n').filter((line: string) => line.trim());

      lines.forEach((line: string) => {
        const cleanLine = line.trim();
        if (cleanLine) {
          log.debug('api/qfield/oes-sync', { action: 'vpsOutput', message: cleanLine });

          res.write(`data: ${JSON.stringify({
            type: 'log',
            message: cleanLine,
            timestamp: new Date().toISOString()
          })}\n\n`);
        }
      });
    });

    // Stream stderr
    ssh.stderr.on('data', (data) => {
      const output = data.toString();
      fullOutput += output;

      const lines = output.split('\n').filter((line: string) => line.trim());

      lines.forEach((line: string) => {
        const cleanLine = line.trim();
        if (cleanLine) {
          log.error('api/qfield/oes-sync', { action: 'vpsError', message: cleanLine });

          res.write(`data: ${JSON.stringify({
            type: 'error',
            message: cleanLine,
            timestamp: new Date().toISOString()
          })}\n\n`);

          hasError = true;
        }
      });
    });

    // Handle process completion
    ssh.on('close', (code) => {
      log.info('api/qfield/oes-sync', { action: 'sshClose', exitCode: code });

      // Parse stats from output
      const stats = parseStats(fullOutput);

      res.write(`data: ${JSON.stringify({
        type: 'complete',
        success: code === 0 && !hasError,
        exitCode: code,
        stats,
        timestamp: new Date().toISOString()
      })}\n\n`);

      res.end();
    });

    // Handle process errors
    ssh.on('error', (error) => {
      log.error('api/qfield/oes-sync', { action: 'sshError', error: error.message });

      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: `SSH connection failed: ${error.message}`,
        timestamp: new Date().toISOString()
      })}\n\n`);

      res.write(`data: ${JSON.stringify({
        type: 'complete',
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })}\n\n`);

      res.end();
    });

  } catch (error: any) {
    log.error('api/qfield/oes-sync', { action: 'syncError', error: error.message });

    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    })}\n\n`);

    res.write(`data: ${JSON.stringify({
      type: 'complete',
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    })}\n\n`);

    res.end();
  }
}

// Parse statistics from script output
function parseStats(output: string): any {
  const stats: any = {
    extracted: 0,
    matched: 0,
    uploaded: 0,
    errors: 0,
    warnings: 0
  };

  // Extract numbers from output
  const extractedMatch = output.match(/Total connections extracted:\s*(\d+)/i) ||
                        output.match(/Extracted\s+(\d+)\s+connections/i) ||
                        output.match(/Found\s+(\d+)\s+projects/i);

  const matchedMatch = output.match(/Successfully matched:\s*(\d+)/i) ||
                      output.match(/Matched:\s*(\d+)/i) ||
                      output.match(/(\d+)\s+matched/i);

  const uploadedMatch = output.match(/Features:\s*(\d+)/i) ||
                       output.match(/Uploaded:\s*(\d+)/i);

  const errorMatch = output.match(/❌/g);
  const warningMatch = output.match(/⚠️/g);

  if (extractedMatch) stats.extracted = parseInt(extractedMatch[1]);
  if (matchedMatch) stats.matched = parseInt(matchedMatch[1]);
  if (uploadedMatch) stats.uploaded = parseInt(uploadedMatch[1]);
  if (errorMatch) stats.errors = errorMatch.length;
  if (warningMatch) stats.warnings = warningMatch.length;

  return stats;
}

export default withAuth(handler);
