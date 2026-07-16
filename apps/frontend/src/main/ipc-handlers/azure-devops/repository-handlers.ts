/**
 * Azure DevOps repository handlers
 * Handles connection status and project management
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, azureDevOpsFetch, azureDevOpsFetchWithCount, encodeProjectName } from './utils';
import type { AzureDevOpsAPIProject } from './types';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[Azure DevOps Repo] ${message}`, data);
    } else {
      console.debug(`[Azure DevOps Repo] ${message}`);
    }
  }
}

/**
 * Azure DevOps sync status type
 */
interface AzureDevOpsSyncStatus {
  connected: boolean;
  error?: string;
  organization?: string;
  project?: string;
  projectId?: string;
  workItemCount?: number;
  lastSyncedAt?: string;
}

/**
 * Check Azure DevOps connection status for a project
 */
export function registerCheckConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION,
    async (_event, projectId: string): Promise<IPCResult<AzureDevOpsSyncStatus>> => {
      debugLog('checkAzureDevOpsConnection handler called', { projectId });

      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const config = await getAzureDevOpsConfig(project);
      if (!config) {
        debugLog('No Azure DevOps config found');
        return {
          success: true,
          data: {
            connected: false,
            error: 'Azure DevOps not configured. Please add AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORGANIZATION, and AZURE_DEVOPS_PROJECT to your .env file.'
          }
        };
      }

      try {
        const encodedProject = encodeProjectName(config.project);

        // Fetch project info
        const projectInfo = await azureDevOpsFetch(
          config.pat,
          config.organization,
          `/projects/${encodedProject}`
        ) as AzureDevOpsAPIProject;

        debugLog('Project info retrieved:', { name: projectInfo.name });

        // Get work item count from WIQL query
        // Using a simple WIQL query to count work items
        const { totalCount: workItemCount } = await azureDevOpsFetchWithCount(
          config.pat,
          config.organization,
          `/${encodedProject}/_apis/wit/wiql?api-version=7.1`,
          {
            method: 'POST',
            body: JSON.stringify({
              query: 'Select [System.Id] From WorkItems'
            })
          }
        );

        return {
          success: true,
          data: {
            connected: true,
            organization: config.organization,
            project: config.project,
            projectId: projectInfo.id,
            workItemCount,
            lastSyncedAt: new Date().toISOString()
          }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to connect to Azure DevOps';
        debugLog('Connection check failed:', errorMessage);
        return {
          success: true,
          data: {
            connected: false,
            error: errorMessage
          }
        };
      }
    }
  );
}

/**
 * Get list of Azure DevOps projects accessible to the user
 */
export function registerGetProjects(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_PROJECTS,
    async (_event, projectId: string): Promise<IPCResult<AzureDevOpsAPIProject[]>> => {
      debugLog('getAzureDevOpsProjects handler called');

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

      try {
        // Fetch list of projects in the organization
        // Azure DevOps returns projects in a 'value' field with pagination support
        const response = await azureDevOpsFetch(
          config.pat,
          config.organization,
          '/_apis/projects?api-version=7.1&$top=100'
        ) as { value: AzureDevOpsAPIProject[] };

        const projects = response.value || [];

        debugLog('Found projects:', projects.length);

        return {
          success: true,
          data: projects
        };
      } catch (error) {
        debugLog('Failed to get projects:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get projects'
        };
      }
    }
  );
}

/**
 * Register all repository handlers
 */
export function registerRepositoryHandlers(): void {
  debugLog('Registering Azure DevOps repository handlers');
  registerCheckConnection();
  registerGetProjects();
  debugLog('Azure DevOps repository handlers registered');
}
