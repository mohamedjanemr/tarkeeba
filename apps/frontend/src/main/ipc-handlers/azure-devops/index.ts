/**
 * Azure DevOps IPC Handlers Module
 *
 * This module exports the main registration function for all Azure DevOps-related IPC handlers.
 */

import type { BrowserWindow } from 'electron';
import type { AgentManager } from '../../agent';

import { registerAzureDevOpsAuthHandlers } from './auth-handlers';
import { registerRepositoryHandlers } from './repository-handlers';
import { registerIssueHandlers } from './issue-handlers';
import { registerInvestigationHandlers } from './investigation-handlers';
import { registerImportHandlers } from './import-handlers';
import { registerPullRequestHandlers } from './pr-handlers';
import { registerPRReviewHandlers } from './pr-review-handlers';
import { registerAutoFixHandlers } from './autofix-handlers';
import { registerTriageHandlers } from './triage-handlers';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string): void {
  if (DEBUG) {
    console.debug(`[Azure DevOps] ${message}`);
  }
}

/**
 * Register all Azure DevOps IPC handlers
 */
export function registerAzureDevOpsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering all Azure DevOps handlers');

  // OAuth and authentication handlers (PAT-based)
  registerAzureDevOpsAuthHandlers();

  // Repository/project handlers
  registerRepositoryHandlers();

  // Issue handlers (work items)
  registerIssueHandlers();

  // Investigation handlers (AI-powered)
  registerInvestigationHandlers(agentManager, getMainWindow);

  // Import handlers
  registerImportHandlers();

  // Pull request handlers
  registerPullRequestHandlers();

  // PR Review handlers (AI-powered)
  registerPRReviewHandlers(getMainWindow);

  // Auto-Fix handlers
  registerAutoFixHandlers(getMainWindow);

  // Triage handlers
  registerTriageHandlers(getMainWindow);

  debugLog('All Azure DevOps handlers registered');
}

// Re-export individual registration functions for custom usage
export {
  registerAzureDevOpsAuthHandlers,
  registerRepositoryHandlers,
  registerIssueHandlers,
  registerInvestigationHandlers,
  registerImportHandlers,
  registerPullRequestHandlers,
  registerPRReviewHandlers,
  registerAutoFixHandlers,
  registerTriageHandlers
};
