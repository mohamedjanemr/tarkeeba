/**
 * Azure DevOps Pull Request handlers
 * Handles PR operations (equivalent to GitHub PRs and GitLab MRs)
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, AzureDevOpsPullRequest } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getAzureDevOpsConfig, azureDevOpsFetch } from './utils';
import type { AzureDevOpsAPIPullRequest, CreatePullRequestOptions } from './types';

// Valid pull request states per Azure DevOps API
// - active: PR is open and can be modified/merged
// - completed: PR has been successfully merged
// - abandoned: PR has been abandoned without merging
const VALID_PR_STATES = ['active', 'completed', 'abandoned', 'all'] as const;
type PullRequestState = typeof VALID_PR_STATES[number];

/**
 * Validate pull request state parameter
 */
function isValidPrState(state: string): state is PullRequestState {
  return VALID_PR_STATES.includes(state as PullRequestState);
}

// Debug logging helper - enabled in development OR when DEBUG flag is set
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[Azure DevOps PR] ${message}`, data);
    } else {
      console.debug(`[Azure DevOps PR] ${message}`);
    }
  }
}

/**
 * Extract branch name from Azure DevOps ref name
 * Azure DevOps uses refs/heads/branch-name format
 */
function extractBranchName(refName: string): string {
  if (refName.startsWith('refs/heads/')) {
    return refName.substring('refs/heads/'.length);
  }
  return refName;
}

/**
 * Transform Azure DevOps API PR to our format
 * Defensively handles missing/null properties
 */
function transformPullRequest(apiPr: AzureDevOpsAPIPullRequest): AzureDevOpsPullRequest {
  return {
    pullRequestId: apiPr.pullRequestId,
    title: apiPr.title || '',
    description: apiPr.description || undefined,
    status: apiPr.status || 'active',
    sourceBranch: extractBranchName(apiPr.sourceRefName || ''),
    targetBranch: extractBranchName(apiPr.targetRefName || ''),
    author: apiPr.createdBy
      ? {
          displayName: apiPr.createdBy.displayName || '',
          imageUrl: apiPr.createdBy.imageUrl || undefined
        }
      : { displayName: '' },
    reviewers: Array.isArray(apiPr.reviewers)
      ? apiPr.reviewers.map(r => ({
          displayName: r?.displayName || '',
          imageUrl: r?.imageUrl || undefined,
          vote: r?.vote ?? 0
        }))
      : [],
    labels: Array.isArray(apiPr.labels) ? apiPr.labels : undefined,
    webUrl: apiPr.url || '',
    createdAt: apiPr.creationDate || new Date().toISOString(),
    updatedAt: apiPr.creationDate || new Date().toISOString(),
    closedAt: apiPr.closedDate || undefined
  };
}

/**
 * Get pull requests from Azure DevOps project
 */
export function registerGetPullRequests(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUESTS,
    async (_event, projectId: string, state?: string): Promise<IPCResult<AzureDevOpsPullRequest[]>> => {
      debugLog('getAzureDevOpsPullRequests handler called', { state });

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

      // Validate state parameter
      const stateParam = state ?? 'active';
      if (!isValidPrState(stateParam)) {
        return {
          success: false,
          error: `Invalid pull request state: '${stateParam}'. Must be one of: ${VALID_PR_STATES.join(', ')}`
        };
      }

      try {
        // Build query parameter for state filtering
        const stateQuery = stateParam === 'all' ? '' : `?status=${stateParam}`;

        // Get repositories first to iterate through them
        const repos = (await azureDevOpsFetch(
          config.pat,
          config.organization,
          `/git/repositories?api-version=7.1`
        )) as { value?: Array<{ id: string; name: string }> };

        const allPrs: AzureDevOpsPullRequest[] = [];

        if (repos.value && Array.isArray(repos.value)) {
          for (const repo of repos.value) {
            try {
              const endpoint = `/git/repositories/${repo.id}/pullrequests${stateQuery}&api-version=7.1`;
              const prsResponse = (await azureDevOpsFetch(
                config.pat,
                config.organization,
                endpoint
              )) as { value?: AzureDevOpsAPIPullRequest[] };

              if (prsResponse.value && Array.isArray(prsResponse.value)) {
                const transformedPrs = prsResponse.value.map(transformPullRequest);
                allPrs.push(...transformedPrs);
              }
            } catch (repoError) {
              debugLog(`Failed to fetch PRs from repository ${repo.name}:`, repoError instanceof Error ? repoError.message : repoError);
              // Continue to next repo on error
            }
          }
        }

        // Sort by creation date (newest first)
        allPrs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        debugLog('Fetched pull requests:', allPrs.length);

        return {
          success: true,
          data: allPrs
        };
      } catch (error) {
        debugLog('Failed to get pull requests:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get pull requests'
        };
      }
    }
  );
}

/**
 * Get a single pull request by ID
 */
export function registerGetPullRequest(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUEST,
    async (_event, projectId: string, repositoryId: string, prId: number): Promise<IPCResult<AzureDevOpsPullRequest>> => {
      debugLog('getAzureDevOpsPullRequest handler called', { prId });

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
        const endpoint = `/git/repositories/${repositoryId}/pullrequests/${prId}?api-version=7.1`;

        const apiPr = (await azureDevOpsFetch(
          config.pat,
          config.organization,
          endpoint
        )) as AzureDevOpsAPIPullRequest;

        const pr = transformPullRequest(apiPr);

        return {
          success: true,
          data: pr
        };
      } catch (error) {
        debugLog('Failed to get pull request:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get pull request'
        };
      }
    }
  );
}

/**
 * Create a new pull request
 */
export function registerCreatePullRequest(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_CREATE_PULL_REQUEST,
    async (_event, projectId: string, repositoryId: string, options: CreatePullRequestOptions): Promise<IPCResult<AzureDevOpsPullRequest>> => {
      debugLog('createAzureDevOpsPullRequest handler called', { title: options.title });

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
        const prBody: Record<string, unknown> = {
          sourceRefName: options.sourceBranch.startsWith('refs/heads/') ? options.sourceBranch : `refs/heads/${options.sourceBranch}`,
          targetRefName: options.targetBranch.startsWith('refs/heads/') ? options.targetBranch : `refs/heads/${options.targetBranch}`,
          title: options.title
        };

        if (options.description !== undefined) {
          prBody.description = options.description;
        }

        if (options.isDraft !== undefined) {
          prBody.isDraft = options.isDraft;
        }

        const endpoint = `/git/repositories/${repositoryId}/pullrequests?api-version=7.1`;

        const apiPr = (await azureDevOpsFetch(
          config.pat,
          config.organization,
          endpoint,
          {
            method: 'POST',
            body: JSON.stringify(prBody)
          }
        )) as AzureDevOpsAPIPullRequest;

        debugLog('Pull request created:', { prId: apiPr.pullRequestId });

        const pr = transformPullRequest(apiPr);

        return {
          success: true,
          data: pr
        };
      } catch (error) {
        debugLog('Failed to create pull request:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create pull request'
        };
      }
    }
  );
}

/**
 * Update a pull request
 */
export function registerUpdatePullRequest(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_UPDATE_PULL_REQUEST,
    async (
      _event,
      projectId: string,
      repositoryId: string,
      prId: number,
      updates: Partial<CreatePullRequestOptions>
    ): Promise<IPCResult<AzureDevOpsPullRequest>> => {
      debugLog('updateAzureDevOpsPullRequest handler called', { prId });

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
        const prBody: Record<string, unknown> = {};

        if (updates.title !== undefined) prBody.title = updates.title;
        if (updates.description !== undefined) prBody.description = updates.description;
        if (updates.isDraft !== undefined) prBody.isDraft = updates.isDraft;

        const endpoint = `/git/repositories/${repositoryId}/pullrequests/${prId}?api-version=7.1`;

        const apiPr = (await azureDevOpsFetch(
          config.pat,
          config.organization,
          endpoint,
          {
            method: 'PATCH',
            body: JSON.stringify(prBody)
          }
        )) as AzureDevOpsAPIPullRequest;

        debugLog('Pull request updated:', { prId: apiPr.pullRequestId });

        const pr = transformPullRequest(apiPr);

        return {
          success: true,
          data: pr
        };
      } catch (error) {
        debugLog('Failed to update pull request:', error instanceof Error ? error.message : error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update pull request'
        };
      }
    }
  );
}

/**
 * Register all pull request handlers
 */
export function registerPullRequestHandlers(): void {
  debugLog('Registering Azure DevOps pull request handlers');
  registerGetPullRequests();
  registerGetPullRequest();
  registerCreatePullRequest();
  registerUpdatePullRequest();
  debugLog('Azure DevOps pull request handlers registered');
}
