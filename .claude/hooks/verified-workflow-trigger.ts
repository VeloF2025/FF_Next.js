#!/usr/bin/env node

/**
 * Verified Workflow Trigger Hook - FibreFlow
 *
 * Auto-triggers workflows when documents are marked as VERIFIED.
 * Monitors page-logs, specs, and PRDs for verification status changes.
 *
 * Hook Type: PostToolUse (after Edit/Write operations)
 *
 * Triggers:
 * - "✅ VERIFIED WORKING" in page-logs → Update CHANGELOG
 * - "VERIFIED" in test specs → Run tests
 * - "APPROVED" in PRDs → Trigger implementation
 */

import * as fs from 'fs';
import * as path from 'path';

interface VerifiedAction {
  type: 'changelog' | 'test' | 'implement' | 'deploy';
  file: string;
  context: string;
}

function detectVerifiedStatus(filePath: string, content: string): VerifiedAction | null {
  const fileName = path.basename(filePath);
  const dirName = path.dirname(filePath);

  // Page logs: VERIFIED WORKING → Update changelog
  if (dirName.includes('page-logs') && content.includes('VERIFIED WORKING')) {
    return {
      type: 'changelog',
      file: filePath,
      context: `Page fix verified: ${fileName}`,
    };
  }

  // Test specs: All tests passing → Ready for PR
  if (filePath.includes('tests/specs/') && content.includes('✅ ALL TESTS PASSING')) {
    return {
      type: 'test',
      file: filePath,
      context: `Test spec verified: ${fileName}`,
    };
  }

  // PRDs: APPROVED → Ready for implementation
  if (filePath.includes('PRDs/') && content.match(/Status:\s*(APPROVED|✅\s*Approved)/i)) {
    return {
      type: 'implement',
      file: filePath,
      context: `PRD approved: ${fileName}`,
    };
  }

  // Staging verified → Ready for production
  if (content.includes('STAGING VERIFIED') || content.includes('✅ Staging OK')) {
    return {
      type: 'deploy',
      file: filePath,
      context: `Staging verified, ready for production`,
    };
  }

  return null;
}

function outputWorkflowSuggestion(action: VerifiedAction): void {
  console.error('');
  console.error('━'.repeat(50));
  console.error('🔔 VERIFIED STATUS DETECTED');
  console.error('━'.repeat(50));
  console.error(`File: ${action.file}`);
  console.error(`Context: ${action.context}`);
  console.error('');

  switch (action.type) {
    case 'changelog':
      console.error('📝 Suggested action: Update CHANGELOG');
      console.error('   Run: /log to add entry');
      break;
    case 'test':
      console.error('✅ Suggested action: Create PR');
      console.error('   Run: /pr to create pull request');
      break;
    case 'implement':
      console.error('🚀 Suggested action: Start implementation');
      console.error('   Run: /auto to implement from PRD');
      break;
    case 'deploy':
      console.error('🌐 Suggested action: Deploy to production');
      console.error('   Run: /deploy to push to production');
      break;
  }

  console.error('━'.repeat(50));
  console.error('');
}

function main() {
  const toolInput = process.env.TOOL_INPUT || '';
  const toolResult = process.env.TOOL_RESULT || '';

  // Extract file path from tool input
  const filePathMatch = toolInput.match(/file_path["\s:]+([^"]+)/);
  if (!filePathMatch) return;

  const filePath = filePathMatch[1];

  // Check if file exists and read content
  if (!fs.existsSync(filePath)) return;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const action = detectVerifiedStatus(filePath, content);

    if (action) {
      outputWorkflowSuggestion(action);
    }
  } catch {
    // Silently ignore read errors
  }
}

main();
