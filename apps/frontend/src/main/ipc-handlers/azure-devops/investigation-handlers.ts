/**
 * Azure DevOps investigation handlers
 * Handles AI-powered work item investigation
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { AzureDevOpsInvestigationStatus, AzureDevOpsInvestigationResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, azureDevOpsFetch } from './utils';
import type { AzureDevOpsAPIWorkItem, AzureDevOpsAPICommentBasic } from './types';
import { createSpecForWorkItem, fetchAllWorkItemComments } from './spec-utils';
import type { AgentManager } from '../../agent';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[Azure DevOps Investigation] ${message}`, data);
    } else {
      console.debug(`[Azure DevOps Investigation] ${message}`);
    }
  }
}

/**
 * Send investigation progress to renderer
 */
function sendProgress(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  status: AzureDevOpsInvestigationStatus
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_PROGRESS, projectId, status);
  }
}

/**
 * Send investigation complete to renderer
 */
function sendComplete(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  result: AzureDevOpsInvestigationResult
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_COMPLETE, projectId, result);
  }
}

/**
 * Send investigation error to renderer
 */
function sendError(
  getMainWindow: () => BrowserWindow | null,
  projectId: string,
  error: string
): void {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_ERROR, projectId, error);
  }
}

/**
 * Register investigation handler
 */
export function registerInvestigateWorkItem(
  _agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.on(
    IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATE_ISSUE,
    async (_event, projectId: string, workItemId: number, selectedCommentIds?: number[]) => {
      debugLog('investigateAzureDevOpsWorkItem handler called', { projectId, workItemId, selectedCommentIds });

      const project = projectStore.getProject(projectId);
      if (!project) {
        sendError(getMainWindow, projectId, 'Project not found');
        return;
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        sendError(getMainWindow, projectId, 'Azure DevOps not configured');
        return;
      }

      try {
        // Phase 1: Fetching work item
        sendProgress(getMainWindow, project.id, {
          phase: 'fetching',
          workItemId,
          progress: 10,
          message: 'Fetching work item details...'
        });

        // Fetch work item
        const workItem = await azureDevOpsFetch(
          config.pat,
          config.organization,
          `/wit/workitems/${workItemId}?api-version=7.1`
        ) as AzureDevOpsAPIWorkItem;

        // Fetch comments if any selected (with pagination to get all comments)
        let filteredComments: AzureDevOpsAPICommentBasic[] = [];
        if (selectedCommentIds && selectedCommentIds.length > 0) {
          // Fetch all comments using the paginated utility function
          const allComments = await fetchAllWorkItemComments(config, config.project, workItemId);
          // Filter comments based on selection
          filteredComments = allComments.filter(comment => selectedCommentIds.includes(comment.id));
        }

        // Phase 2: Creating task
        sendProgress(getMainWindow, project.id, {
          phase: 'creating_task',
          workItemId,
          progress: 50,
          message: 'Creating task from work item...'
        });

        // Create spec for the work item with comments
        const task = await createSpecForWorkItem(
          project,
          workItem,
          config,
          project.settings?.mainBranch,
          filteredComments
        );

        if (!task) {
          sendError(getMainWindow, project.id, 'Failed to create task from work item');
          return;
        }

        // Phase 3: Complete
        sendProgress(getMainWindow, project.id, {
          phase: 'complete',
          workItemId,
          progress: 100,
          message: 'Investigation complete'
        });

        // Send result
        const result: AzureDevOpsInvestigationResult = {
          success: true,
          workItemId,
          analysis: {
            summary: `Investigation of Azure DevOps work item #${workItemId}: ${workItem.title}`,
            proposedSolution: workItem.description || 'See task details for more information.',
            affectedFiles: [],
            estimatedComplexity: 'standard',
            acceptanceCriteria: []
          },
          taskId: task.id
        };

        sendComplete(getMainWindow, project.id, result);
        debugLog('Investigation complete:', { workItemId, taskId: task.id });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Investigation failed';
        debugLog('Investigation failed:', errorMessage);
        sendError(getMainWindow, project.id, errorMessage);
      }
    }
  );
}

/**
 * Register all investigation handlers
 */
export function registerInvestigationHandlers(
  agentManager: AgentManager,
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering Azure DevOps investigation handlers');
  registerInvestigateWorkItem(agentManager, getMainWindow);
  debugLog('Azure DevOps investigation handlers registered');
}
