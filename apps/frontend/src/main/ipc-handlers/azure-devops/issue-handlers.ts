/**
 * Azure DevOps work item handlers
 * Handles fetching work items and comments
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, AzureDevOpsWorkItem, AzureDevOpsComment } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, azureDevOpsFetch, encodeProjectName } from './utils';
import type { AzureDevOpsAPIWorkItem, AzureDevOpsAPIComment } from './types';

// Debug logging helper - enabled in development OR when DEBUG flag is set
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[Azure DevOps Work Items] ${message}`, data);
    } else {
      console.debug(`[Azure DevOps Work Items] ${message}`);
    }
  }
}

/**
 * Transform Azure DevOps API work item to our format
 */
function transformWorkItem(apiWorkItem: AzureDevOpsAPIWorkItem, projectName: string): AzureDevOpsWorkItem {
  return {
    id: apiWorkItem.id,
    title: apiWorkItem.title,
    description: apiWorkItem.description,
    state: apiWorkItem.state,
    workItemType: apiWorkItem.workItemType,
    tags: apiWorkItem.tags ?? [],
    assignedTo: apiWorkItem.assignedTo
      ? {
          displayName: apiWorkItem.assignedTo.displayName,
          imageUrl: apiWorkItem.assignedTo.imageUrl
        }
      : undefined,
    author: {
      displayName: apiWorkItem.createdBy.displayName,
      imageUrl: apiWorkItem.createdBy.imageUrl
    },
    createdAt: apiWorkItem.createdDate,
    updatedAt: apiWorkItem.changedDate,
    closedAt: apiWorkItem.closedDate,
    commentCount: apiWorkItem.commentCount ?? 0,
    webUrl: apiWorkItem.webUrl,
    projectName
  };
}

/**
 * Transform Azure DevOps API comment to our format
 */
function transformComment(apiComment: AzureDevOpsAPIComment): AzureDevOpsComment {
  return {
    id: apiComment.id,
    content: apiComment.content,
    author: {
      displayName: apiComment.author.displayName,
      imageUrl: apiComment.author.imageUrl
    },
    createdAt: apiComment.createdDate,
    updatedAt: apiComment.modifiedDate,
    isDeleted: apiComment.isDeleted
  };
}

/**
 * Get work items from Azure DevOps project
 */
export function registerGetIssues(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_ISSUES,
    async (_event, projectId: string, state?: string): Promise<IPCResult<AzureDevOpsWorkItem[]>> => {
      debugLog('getAzureDevOpsIssues handler called', { state });

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
        const encodedProject = encodeProjectName(config.project);
        const stateFilter = state ? `&fields=System.State&filterCriteria={"fields":["System.State"],"logicalOperator":"and","clauses":[{"index":0,"operator":"=","value":"${state}"}]}` : '';

        const apiResponse = await azureDevOpsFetch(
          config.pat,
          config.organization,
          `/wit/wiql?api-version=7.0`,
          {
            method: 'POST',
            body: JSON.stringify({
              query: `SELECT [System.Id], [System.Title], [System.Description], [System.State], [System.WorkItemType], [System.Tags], [System.AssignedTo], [System.CreatedBy], [System.CreatedDate], [System.ChangedDate], [System.ClosedDate], [System.CommentCount] FROM workitems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC`
            })
          }
        ) as { workItems: Array<{ id: number; url: string }> };

        if (!apiResponse.workItems || apiResponse.workItems.length === 0) {
          debugLog('No work items found');
          return { success: true, data: [] };
        }

        // Fetch detailed information for each work item
        const workItemIds = apiResponse.workItems.map((wi) => wi.id);
        const batchResponse = await azureDevOpsFetch(
          config.pat,
          config.organization,
          `/wit/workitemsbatch?api-version=7.0`,
          {
            method: 'POST',
            body: JSON.stringify({
              ids: workItemIds,
              fields: [
                'System.Id',
                'System.Title',
                'System.Description',
                'System.State',
                'System.WorkItemType',
                'System.Tags',
                'System.AssignedTo',
                'System.CreatedBy',
                'System.CreatedDate',
                'System.ChangedDate',
                'System.ClosedDate',
                'System.CommentCount'
              ]
            })
          }
        ) as { value: Array<{ id: number; fields: Record<string, unknown> }> };

        const workItems = (batchResponse.value ?? [])
          .map((item) => {
            const fields = item.fields as Record<string, unknown>;
            const apiWorkItem: AzureDevOpsAPIWorkItem = {
              id: item.id,
              rev: 0,
              title: (fields['System.Title'] as string) || 'Untitled',
              description: (fields['System.Description'] as string) || undefined,
              state: (fields['System.State'] as string) || 'New',
              workItemType: (fields['System.WorkItemType'] as string) || 'Unknown',
              tags: (fields['System.Tags'] as string)?.split(';').map((t) => t.trim()) || [],
              assignedTo: fields['System.AssignedTo']
                ? {
                    displayName: ((fields['System.AssignedTo'] as Record<string, unknown>).displayName as string) || 'Unknown',
                    uniqueName: ((fields['System.AssignedTo'] as Record<string, unknown>).uniqueName as string) || '',
                    imageUrl: ((fields['System.AssignedTo'] as Record<string, unknown>).imageUrl as string) || undefined
                  }
                : undefined,
              createdBy: {
                displayName: ((fields['System.CreatedBy'] as Record<string, unknown>).displayName as string) || 'Unknown',
                uniqueName: ((fields['System.CreatedBy'] as Record<string, unknown>).uniqueName as string) || '',
                imageUrl: ((fields['System.CreatedBy'] as Record<string, unknown>).imageUrl as string) || undefined
              },
              createdDate: (fields['System.CreatedDate'] as string) || new Date().toISOString(),
              changedDate: (fields['System.ChangedDate'] as string) || new Date().toISOString(),
              closedDate: (fields['System.ClosedDate'] as string) || undefined,
              commentCount: (fields['System.CommentCount'] as number) || 0,
              url: '',
              webUrl: `${config.organization}/${config.project}/_workitems/edit/${item.id}`
            };

            return transformWorkItem(apiWorkItem, config.project);
          });

        debugLog('Fetched work items:', workItems.length);

        return {
          success: true,
          data: workItems
        };
      } catch (error) {
        debugLog('Failed to get work items:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get work items'
        };
      }
    }
  );
}

/**
 * Get a single work item by ID
 */
export function registerGetIssue(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_ISSUE,
    async (_event, projectId: string, workItemId: number): Promise<IPCResult<AzureDevOpsWorkItem>> => {
      debugLog('getAzureDevOpsIssue handler called', { workItemId });

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
        const batchResponse = await azureDevOpsFetch(
          config.pat,
          config.organization,
          `/wit/workitemsbatch?api-version=7.0`,
          {
            method: 'POST',
            body: JSON.stringify({
              ids: [workItemId],
              fields: [
                'System.Id',
                'System.Title',
                'System.Description',
                'System.State',
                'System.WorkItemType',
                'System.Tags',
                'System.AssignedTo',
                'System.CreatedBy',
                'System.CreatedDate',
                'System.ChangedDate',
                'System.ClosedDate',
                'System.CommentCount'
              ]
            })
          }
        ) as { value: Array<{ id: number; fields: Record<string, unknown> }> };

        const item = (batchResponse.value ?? [])[0];
        if (!item) {
          return { success: false, error: 'Work item not found' };
        }

        const fields = item.fields as Record<string, unknown>;
        const apiWorkItem: AzureDevOpsAPIWorkItem = {
          id: item.id,
          rev: 0,
          title: (fields['System.Title'] as string) || 'Untitled',
          description: (fields['System.Description'] as string) || undefined,
          state: (fields['System.State'] as string) || 'New',
          workItemType: (fields['System.WorkItemType'] as string) || 'Unknown',
          tags: (fields['System.Tags'] as string)?.split(';').map((t) => t.trim()) || [],
          assignedTo: fields['System.AssignedTo']
            ? {
                displayName: ((fields['System.AssignedTo'] as Record<string, unknown>).displayName as string) || 'Unknown',
                uniqueName: ((fields['System.AssignedTo'] as Record<string, unknown>).uniqueName as string) || '',
                imageUrl: ((fields['System.AssignedTo'] as Record<string, unknown>).imageUrl as string) || undefined
              }
            : undefined,
          createdBy: {
            displayName: ((fields['System.CreatedBy'] as Record<string, unknown>).displayName as string) || 'Unknown',
            uniqueName: ((fields['System.CreatedBy'] as Record<string, unknown>).uniqueName as string) || '',
            imageUrl: ((fields['System.CreatedBy'] as Record<string, unknown>).imageUrl as string) || undefined
          },
          createdDate: (fields['System.CreatedDate'] as string) || new Date().toISOString(),
          changedDate: (fields['System.ChangedDate'] as string) || new Date().toISOString(),
          closedDate: (fields['System.ClosedDate'] as string) || undefined,
          commentCount: (fields['System.CommentCount'] as number) || 0,
          url: '',
          webUrl: `${config.organization}/${config.project}/_workitems/edit/${item.id}`
        };

        const workItem = transformWorkItem(apiWorkItem, config.project);

        return {
          success: true,
          data: workItem
        };
      } catch (error) {
        debugLog('Failed to get work item:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get work item'
        };
      }
    }
  );
}

/**
 * Get comments for a work item
 */
export function registerGetIssueComments(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_ISSUE_COMMENTS,
    async (_event, projectId: string, workItemId: number): Promise<IPCResult<AzureDevOpsComment[]>> => {
      debugLog('getAzureDevOpsIssueComments handler called', { workItemId });

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
        const encodedProject = encodeProjectName(config.project);

        const apiResponse = await azureDevOpsFetch(
          config.pat,
          config.organization,
          `/${encodedProject}/_apis/wit/workitems/${workItemId}/comments?api-version=7.0`
        ) as { comments: AzureDevOpsAPIComment[] } | { value: AzureDevOpsAPIComment[] };

        let comments: AzureDevOpsAPIComment[] = [];
        if ('comments' in apiResponse) {
          comments = apiResponse.comments;
        } else if ('value' in apiResponse) {
          comments = apiResponse.value;
        }

        // Filter out deleted comments for cleaner display
        const activeComments = comments.filter((comment) => !comment.isDeleted);
        const transformedComments = activeComments.map(transformComment);

        debugLog('Fetched comments:', transformedComments.length);

        return {
          success: true,
          data: transformedComments
        };
      } catch (error) {
        debugLog('Failed to get comments:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get comments'
        };
      }
    }
  );
}

/**
 * Register all work item handlers
 */
export function registerIssueHandlers(): void {
  debugLog('Registering Azure DevOps work item handlers');
  registerGetIssues();
  registerGetIssue();
  registerGetIssueComments();
  debugLog('Azure DevOps work item handlers registered');
}
