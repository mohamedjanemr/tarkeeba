/**
 * Azure DevOps Handlers Entry Point
 *
 * This file serves as the main entry point for Azure DevOps IPC handlers,
 * delegating to the modular handlers in the azure-devops/ directory.
 */

import type { BrowserWindow } from 'electron';
import type { AgentManager } from '../agent';
import { registerAzureDevOpsHandlers } from './azure-devops/index';

export { registerAzureDevOpsHandlers };

/**
 * Default export for consistency with other handler modules
 */
export default function setupAzureDevOpsHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  registerAzureDevOpsHandlers(agentManager, getMainWindow);
}
