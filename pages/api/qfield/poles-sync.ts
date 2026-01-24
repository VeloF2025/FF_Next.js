import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { spawn } from 'child_process';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendLog = (type: string, message?: string, data?: any) => {
    const log = {
      type,
      message,
      timestamp: new Date().toISOString(),
      ...data,
    };
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  };

  try {
    sendLog('start');
    sendLog('log', '🚀 Starting poles sync pipeline...');

    // Run the poles sync wrapper script
    const scriptPath = '/home/louisdup/VF/vps/hostinger/qfield/poles-sync-ui/sync-wrapper.sh';

    const process = spawn('bash', [scriptPath, projectId], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    let output = '';
    let errorOutput = '';

    process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          sendLog('log', line.trim());
          output += line + '\n';
        }
      });
    });

    process.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          sendLog('error', line.trim());
          errorOutput += line + '\n';
        }
      });
    });

    process.on('close', (code) => {
      if (code === 0) {
        // Try to parse stats from output
        const stats = {
          total_poles: extractNumber(output, /Total Poles.*?(\d+)/i),
          planted: extractNumber(output, /Planted.*?(\d+)/i),
          surveyed: extractNumber(output, /Surveyed.*?(\d+)/i),
          unknown: extractNumber(output, /Unknown.*?(\d+)/i),
          duplicates_merged: extractNumber(output, /Merged.*?(\d+)/i),
        };

        sendLog('complete', 'Poles sync completed successfully', {
          success: true,
          stats,
        });
      } else {
        sendLog('complete', `Poles sync failed with exit code ${code}`, {
          success: false,
          error: errorOutput || 'Unknown error',
        });
      }

      res.end();
    });

    process.on('error', (error) => {
      sendLog('error', `Failed to start sync: ${error.message}`);
      sendLog('complete', 'Poles sync failed', {
        success: false,
        error: error.message,
      });
      res.end();
    });
  } catch (error: any) {
    sendLog('error', `Error: ${error.message}`);
    sendLog('complete', 'Poles sync failed', {
      success: false,
      error: error.message,
    });
    res.end();
  }
}

function extractNumber(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
}

export default withAuth(handler);
