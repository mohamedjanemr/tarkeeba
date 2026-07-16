/**
 * Azure DevOps import handlers
 * Handles bulk importing work items as tasks
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, AzureDevOpsImportResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, azureDevOpsFetch } from './utils';
import type { AzureDevOpsAPIWorkItem, AzureDevOpsAPICommentBasic } from './types';
import { createSpecForWorkItem, AzureDevOpsTaskInfo, fetchAllWorkItemComments } from './spec-utils';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[Azure DevOps Import] ${message}`, data);
    } else {
      console.debug(`[Azure DevOps Import] ${message}`);
    }
  }
}

/**
 * Import multiple Azure DevOps work items as tasks
 */
export function registerImportWorkItems(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_IMPORT_ISSUES,
    async (_event, projectId: string, workItemIds: number[]): Promise<IPCResult<AzureDevOpsImportResult>> => {
      debugLog('importAzureDevOpsWorkItems handler called', { workItemIds });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        return {
          success: false,
          error: 'Azure DevOps not configured'
        };
      }

      const tasks: AzureDevOpsTaskInfo[] = [];
      const errors: string[] = [];
      let imported = 0;
      let failed = 0;

      for (const workItemId of workItemIds) {
        try {
          // Fetch the work item
          const apiWorkItem = await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/wit/workitems/${workItemId}`,
            { headers: { 'api-version': '7.0' } }
          ) as AzureDevOpsAPIWorkItem;

          // Fetch comments for this work item
          let comments: AzureDevOpsAPICommentBasic[] = [];
          try {
            comments = await fetchAllWorkItemComments(
              { pat: config.pat, organization: config.organization },
              config.project,
              workItemId
            );
          } catch (commentError) {
            // Log comment fetch failure but continue without comments
            debugLog('Failed to fetch comments for work item, continuing without them:', { workItemId, error: commentError });
          }

          // Create a spec/task from the work item
          const task = await createSpecForWorkItem(
            project,
            apiWorkItem,
            config,
            project.settings?.mainBranch,
            comments
          );

          if (task) {
            tasks.push(task);
            imported++;
            debugLog('Imported work item:', { id: workItemId, taskId: task.id });
          } else {
            failed++;
            errors.push(`Failed to create task for work item #${workItemId}`);
          }
        } catch (error) {
          failed++;
          const errorMessage = error instanceof Error ? error.message : `Unknown error for work item #${workItemId}`;
          errors.push(errorMessage);
          debugLog('Failed to import work item:', { id: workItemId, error: errorMessage });
        }
      }

      // Note: IPCResult.success indicates transport success (IPC call completed without system error).
      // data.success indicates operation success (at least one work item was imported).
      // This distinction allows the UI to differentiate between system failures and partial imports.
      return {
        success: true,
        data: {
          success: imported > 0,
          imported,
          failed,
          errors: errors.length > 0 ? errors : undefined
        }
      };
    }
  );
}

/**
 * Register all import handlers
 */
export function registerImportHandlers(): void {
  debugLog('Registering Azure DevOps import handlers');
  registerImportWorkItems();
  debugLog('Azure DevOps import handlers registered');
}
