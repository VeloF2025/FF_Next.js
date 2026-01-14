/**
 * Python Backend Integration Service
 * Calls the Python evaluate_dr.py script via child_process
 */

import { spawn } from 'child_process';
import { EvaluationResult } from '../types';
import { log } from '@/lib/logger';

interface PythonEvaluationResponse {
  status: 'success' | 'error';
  message?: string;
  overall_status?: 'PASS' | 'FAIL';
  overall_score?: number;
  total_steps?: number;
  passed_steps?: number;
  results?: any;
  summary?: string;
  report_path?: string;
}

export class PythonEvaluationError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = 'PythonEvaluationError';
  }
}

/**
 * Execute Python evaluation script and return results
 * @param drNumber - DR number to evaluate (e.g., "DR1733592")
 * @returns Evaluation results from Python script
 */
export async function executePythonEvaluation(
  drNumber: string
): Promise<EvaluationResult> {
  const pythonScriptPath = process.env.PYTHON_SCRIPT_PATH ||
    '/home/louisdup/VF/agents/foto/foto-evaluator-ach/evaluate_dr.py';

  const pythonPath = process.env.PYTHON_PATH || 'python3';

  return new Promise((resolve, reject) => {
    log.info('PythonService', `Executing: ${pythonPath} ${pythonScriptPath} ${drNumber}`);

    const pythonProcess = spawn(pythonPath, [pythonScriptPath, drNumber], {
      env: {
        ...process.env,
        // Pass environment variables to Python script
        NEON_DB_HOST: process.env.NEON_DB_HOST,
        NEON_DB_NAME: process.env.NEON_DB_NAME,
        NEON_DB_USER: process.env.NEON_DB_USER,
        NEON_DB_PASSWORD: process.env.NEON_DB_PASSWORD,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        BOSS_VPS_API_URL: process.env.BOSS_VPS_API_URL,
      },
      cwd: '/home/louisdup/VF/agents/foto/foto-evaluator-ach',
    });

    let stdout = '';
    let stderr = '';
    let jsonOutput: PythonEvaluationResponse | null = null;

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      log.debug('PythonService', `stdout: ${output.trim()}`);

      // Try to parse JSON from stdout
      try {
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
            jsonOutput = JSON.parse(line.trim());
          }
        }
      } catch (e) {
        // Not JSON, continue
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(`[Python stderr]: ${output.trim()}`);
    });

    pythonProcess.on('close', (code) => {
      log.info('PythonService', `Process exited with code ${code}`);

      if (code !== 0) {
        reject(
          new PythonEvaluationError(
            `Python script failed with exit code ${code}`,
            `EXIT_${code}`,
            stderr
          )
        );
        return;
      }

      // If we captured JSON output, parse it
      if (jsonOutput) {
        try {
          const result = parsePythonOutput(drNumber, jsonOutput);
          resolve(result);
        } catch (error) {
          reject(
            new PythonEvaluationError(
              `Failed to parse Python output: ${error instanceof Error ? error.message : 'Unknown error'}`,
              'PARSE_ERROR',
              stderr
            )
          );
        }
        return;
      }

      // If no JSON, try to parse the entire stdout
      try {
        // Look for JSON in stdout
        const jsonMatch = stdout.match(/\{[\s\S]*"status"[\s\S]*\}/);
        if (jsonMatch) {
          const parsedOutput = JSON.parse(jsonMatch[0]);
          const result = parsePythonOutput(drNumber, parsedOutput);
          resolve(result);
        } else {
          reject(
            new PythonEvaluationError(
              'Python script did not return JSON output',
              'NO_JSON_OUTPUT',
              stdout
            )
          );
        }
      } catch (error) {
        reject(
          new PythonEvaluationError(
            `Failed to parse Python output: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'PARSE_ERROR',
            stderr
          )
        );
      }
    });

    pythonProcess.on('error', (error) => {
      console.error(`[Python] Failed to start process:`, error);
      reject(
        new PythonEvaluationError(
          `Failed to start Python process: ${error.message}`,
          'SPAWN_ERROR'
        )
      );
    });
  });
}

/**
 * Parse Python script output into EvaluationResult format
 */
function parsePythonOutput(
  drNumber: string,
  pythonOutput: PythonEvaluationResponse
): EvaluationResult {
  if (pythonOutput.status === 'error') {
    throw new Error(pythonOutput.message || 'Python evaluation failed');
  }

  // Convert Python output format to our TypeScript format
  const stepResults = pythonOutput.results
    ? Object.entries(pythonOutput.results).map(([stepNum, result]: [string, any]) => ({
        step_number: parseInt(stepNum, 10),
        step_name: result.step_name || `step_${stepNum}`,
        step_label: result.step_name || `Step ${stepNum}`,
        passed: result.passed || false,
        score: result.score || 0,
        comment: result.recommendation || result.issues?.join('; ') || 'No comment',
      }))
    : [];

  return {
    dr_number: drNumber,
    overall_status: pythonOutput.overall_status || 'FAIL',
    average_score: pythonOutput.overall_score || 0,
    total_steps: pythonOutput.total_steps || 12,
    passed_steps: pythonOutput.passed_steps || 0,
    step_results: stepResults,
    feedback_sent: false,
    evaluation_date: new Date(),
    markdown_report: pythonOutput.summary,
  };
}
