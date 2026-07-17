/**
 * Azure DevOps Auto-Fix IPC handlers
 *
 * Handles automatic fixing of Azure DevOps work items by:
 * 1. Detecting work items with configured tags (e.g., "auto-fix")
 * 2. Creating specs from work items
 * 3. Running the build pipeline
 * 4. Creating PRs when complete
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../../../shared/constants';
import { getAzureDevOpsConfig, azureDevOpsFetch, encodeProjectName } from './utils';
import { withProjectOrNull } from '../github/utils/project-middleware';
import type { Project } from '../../../shared/types';
import type {
  AzureDevOpsAutoFixConfig,
  AzureDevOpsAutoFixQueueItem,
  AzureDevOpsAutoFixProgress,
  AzureDevOpsWorkItemBatch,
  AzureDevOpsAnalyzePreviewResult,
} from './types';

// Debug logging
function debugLog(message: string, ...args: unknown[]): void {
  console.log(`[Azure DevOps AutoFix] ${message}`, ...args);
}

function sanitizeWorkItemUrl(rawUrl: unknown, organizationUrl: string): string {
  if (typeof rawUrl !== 'string') return '';
  try {
    const parsedUrl = new URL(rawUrl);
    const parsedOrgUrl = new URL(organizationUrl);
    // Validate that organization URL uses HTTPS for security
    if (parsedOrgUrl.protocol !== 'https:') {
      console.warn(`[Azure DevOps AutoFix] Organization URL does not use HTTPS: ${organizationUrl}`);
      return '';
    }
    // Validate protocol is HTTPS for security
    if (parsedUrl.protocol !== 'https:') return '';
    // Reject URLs with embedded credentials (security risk)
    if (parsedUrl.username || parsedUrl.password) return '';
    return parsedUrl.toString();
  } catch {
    return '';
  }
}

/**
 * Validate that a resolved path stays within the project directory
 * Prevents path traversal attacks via malicious project.path values
 */
function validatePathWithinProject(projectPath: string, resolvedPath: string): void {
  const normalizedProject = path.resolve(projectPath);
  const normalizedResolved = path.resolve(resolvedPath);

  if (!normalizedResolved.startsWith(normalizedProject + path.sep) && normalizedResolved !== normalizedProject) {
    throw new Error('Invalid path: path traversal detected');
  }
}

/**
 * Get the Azure DevOps directory for a project
 */
function getAzureDevOpsDir(project: Project): string {
  const azureDevOpsDir = path.join(project.path, '.auto-claude', 'azure-devops');
  validatePathWithinProject(project.path, azureDevOpsDir);
  return azureDevOpsDir;
}

/**
 * Get the auto-fix config for a project
 */
function getAutoFixConfig(project: Project): AzureDevOpsAutoFixConfig {
  const configPath = path.join(getAzureDevOpsDir(project), 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        enabled: data.auto_fix_enabled ?? false,
        labels: data.auto_fix_labels ?? ['auto-fix'],
        requireHumanApproval: data.require_human_approval ?? true,
        model: data.model ?? 'claude-sonnet-5',
        thinkingLevel: data.thinking_level ?? 'medium',
      };
    } catch {
      // Return defaults
    }
  }

  return {
    enabled: false,
    labels: ['auto-fix'],
    requireHumanApproval: true,
    model: 'claude-sonnet-5',
    thinkingLevel: 'medium',
  };
}

/**
 * Save the auto-fix config for a project
 */
function saveAutoFixConfig(project: Project, config: AzureDevOpsAutoFixConfig): void {
  const azureDevOpsDir = getAzureDevOpsDir(project);
  fs.mkdirSync(azureDevOpsDir, { recursive: true });

  const configPath = path.join(azureDevOpsDir, 'config.json');
  let existingConfig: Record<string, unknown> = {};

  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // Use empty config
  }

  const updatedConfig = {
    ...existingConfig,
    auto_fix_enabled: config.enabled,
    auto_fix_labels: config.labels,
    require_human_approval: config.requireHumanApproval,
    model: config.model,
    thinking_level: config.thinkingLevel,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Get the auto-fix queue for a project
 */
function getAutoFixQueue(project: Project): AzureDevOpsAutoFixQueueItem[] {
  const workItemsDir = path.join(getAzureDevOpsDir(project), 'work-items');

  if (!fs.existsSync(workItemsDir)) {
    return [];
  }

  const queue: AzureDevOpsAutoFixQueueItem[] = [];
  const files = fs.readdirSync(workItemsDir);

  for (const file of files) {
    if (file.startsWith('autofix_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(workItemsDir, file), 'utf-8'));
        queue.push({
          workItemId: data.work_item_id,
          project: data.project,
          status: data.status,
          specId: data.spec_id,
          prId: data.pr_id,
          error: data.error,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return queue.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Get batches from disk
 */
function getBatches(project: Project): AzureDevOpsWorkItemBatch[] {
  const batchesDir = path.join(getAzureDevOpsDir(project), 'batches');

  if (!fs.existsSync(batchesDir)) {
    return [];
  }

  const batches: AzureDevOpsWorkItemBatch[] = [];
  const files = fs.readdirSync(batchesDir);

  for (const file of files) {
    if (file.startsWith('batch_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf-8'));
        batches.push({
          id: data.batch_id,
          workItems: data.work_items.map((w: Record<string, unknown>) => ({
            id: w.id as number,
            title: w.title as string,
            similarity: w.similarity as number ?? 1.0,
          })),
          commonThemes: data.common_themes ?? [],
          confidence: data.confidence ?? 1.0,
          reasoning: data.reasoning ?? '',
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return batches;
}

/**
 * Check for work items with auto-fix tags
 */
async function checkAutoFixTags(project: Project): Promise<number[]> {
  const config = getAutoFixConfig(project);
  if (!config.enabled || config.labels.length === 0) {
    return [];
  }

  const adoConfig = await getAzureDevOpsConfig(project);
  if (!adoConfig) {
    return [];
  }

  // Build WIQL query to find work items with auto-fix tags
  const tagConditions = config.labels.map(label => `[System.Tags] Contains '${label.replace(/'/g, "''")}'`).join(' OR ');
  const wiqlQuery = {
    query: `Select [System.Id] From WorkItems Where [System.TeamProject] = @project AND [System.State] <> 'Closed' AND (${tagConditions})`,
  };

  try {
    const result = await azureDevOpsFetch(
      adoConfig.pat,
      adoConfig.organization,
      `/wit/wiql?api-version=7.0`,
      {
        method: 'POST',
        body: JSON.stringify(wiqlQuery),
      }
    ) as { workItems: Array<{ id: number }> };

    // Filter for work items not already in queue
    const queue = getAutoFixQueue(project);
    const pendingWorkItems = new Set(queue.map(q => q.workItemId));

    const matchingWorkItems: number[] = [];

    for (const workItem of result.workItems || []) {
      // Skip already in queue
      if (pendingWorkItems.has(workItem.id)) continue;
      matchingWorkItems.push(workItem.id);
    }

    return matchingWorkItems;
  } catch (error) {
    debugLog('Failed to check auto-fix tags', { error: error instanceof Error ? error.message : error });
    return [];
  }
}

/**
 * Check for NEW work items not yet in the auto-fix queue (no tags required)
 */
async function checkNewWorkItems(project: Project): Promise<Array<{ id: number }>> {
  const config = getAutoFixConfig(project);
  if (!config.enabled) {
    return [];
  }

  const adoConfig = await getAzureDevOpsConfig(project);
  if (!adoConfig) {
    return [];
  }

  const queue = getAutoFixQueue(project);
  const pendingWorkItems = new Set(queue.map(q => q.workItemId));

  try {
    // Fetch open work items
    const wiqlQuery = {
      query: "Select [System.Id] From WorkItems Where [System.TeamProject] = @project AND [System.State] <> 'Closed'",
    };

    const result = await azureDevOpsFetch(
      adoConfig.pat,
      adoConfig.organization,
      `/wit/wiql?api-version=7.0`,
      {
        method: 'POST',
        body: JSON.stringify(wiqlQuery),
      }
    ) as { workItems: Array<{ id: number }> };

    // Filter for new work items not in queue
    return (result.workItems || [])
      .filter(workItem => !pendingWorkItems.has(workItem.id))
      .map(workItem => ({ id: workItem.id }));
  } catch (error) {
    debugLog('Failed to check new work items', { error: error instanceof Error ? error.message : error });
    return [];
  }
}

/**
 * Send IPC progress event
 */
function sendProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  progress: AzureDevOpsAutoFixProgress
): void {
  mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_PROGRESS, projectId, progress);
}

/**
 * Send IPC error event
 */
function sendError(
  mainWindow: BrowserWindow,
  projectId: string,
  error: string
): void {
  mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ERROR, projectId, error);
}

/**
 * Send IPC complete event
 */
function sendComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  data: AzureDevOpsAutoFixQueueItem
): void {
  mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_COMPLETE, projectId, data);
}

/**
 * Start auto-fix for a work item
 */
async function startAutoFix(
  project: Project,
  workItemId: number,
  mainWindow: BrowserWindow
): Promise<void> {
  const adoConfig = await getAzureDevOpsConfig(project);
  if (!adoConfig) {
    throw new Error('No Azure DevOps configuration found');
  }

  sendProgress(mainWindow, project.id, {
    phase: 'fetching',
    workItemId,
    progress: 10,
    message: `Fetching work item #${workItemId}...`,
  });

  // Fetch the work item
  const workItem = await azureDevOpsFetch(
    adoConfig.pat,
    adoConfig.organization,
    `/wit/workitems/${workItemId}?api-version=7.0`
  ) as {
    id: number;
    fields?: Record<string, unknown>;
    url: string;
  };

  sendProgress(mainWindow, project.id, {
    phase: 'analyzing',
    workItemId,
    progress: 30,
    message: 'Analyzing work item...',
  });

  sendProgress(mainWindow, project.id, {
    phase: 'creating_spec',
    workItemId,
    progress: 50,
    message: 'Creating spec from work item...',
  });

  // Validate workItemId
  if (!Number.isInteger(workItemId) || workItemId <= 0) {
    throw new Error('Invalid work item ID');
  }

  // Save auto-fix state
  const workItemsDir = path.join(getAzureDevOpsDir(project), 'work-items');
  fs.mkdirSync(workItemsDir, { recursive: true });

  const state: AzureDevOpsAutoFixQueueItem = {
    workItemId,
    project: adoConfig.project,
    status: 'creating_spec',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Validate and sanitize network data before writing to file
  const sanitizedWorkItemUrl = sanitizeWorkItemUrl(workItem.url, `https://dev.azure.com/${adoConfig.organization}`);
  const sanitizedProject = typeof adoConfig.project === 'string' ? adoConfig.project : '';

  fs.writeFileSync(
    path.join(workItemsDir, `autofix_${workItemId}.json`),
    JSON.stringify({
      work_item_id: state.workItemId,
      project: sanitizedProject,
      status: state.status,
      created_at: state.createdAt,
      updated_at: state.updatedAt,
      work_item_url: sanitizedWorkItemUrl,
    }, null, 2),
    'utf-8'
  );

  sendProgress(mainWindow, project.id, {
    phase: 'complete',
    workItemId,
    progress: 100,
    message: 'Auto-fix spec created! Start the build to continue.',
  });

  sendComplete(mainWindow, project.id, state);
}

/**
 * Register auto-fix related handlers
 */
export function registerAutoFixHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering AutoFix handlers');

  // Get auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_GET_CONFIG,
    async (_, projectId: string): Promise<AzureDevOpsAutoFixConfig | null> => {
      debugLog('getAutoFixConfig handler called', { projectId });
      return withProjectOrNull(projectId, async (project) => {
        return getAutoFixConfig(project);
      });
    }
  );

  // Save auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_SAVE_CONFIG,
    async (_, projectId: string, config: AzureDevOpsAutoFixConfig): Promise<boolean> => {
      debugLog('saveAutoFixConfig handler called', { projectId, enabled: config.enabled });
      const result = await withProjectOrNull(projectId, async (project) => {
        saveAutoFixConfig(project, config);
        return true;
      });
      return result ?? false;
    }
  );

  // Get auto-fix queue
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_GET_QUEUE,
    async (_, projectId: string): Promise<AzureDevOpsAutoFixQueueItem[]> => {
      debugLog('getAutoFixQueue handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return getAutoFixQueue(project);
      });
      return result ?? [];
    }
  );

  // Check for work items with auto-fix labels (tags)
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_CHECK_LABELS,
    async (_, projectId: string): Promise<number[]> => {
      debugLog('checkAutoFixTags handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return checkAutoFixTags(project);
      });
      return result ?? [];
    }
  );

  // Check for NEW work items not yet in auto-fix queue
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_CHECK_NEW,
    async (_, projectId: string): Promise<Array<{ id: number }>> => {
      debugLog('checkNewWorkItems handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return checkNewWorkItems(project);
      });
      return result ?? [];
    }
  );

  // Start auto-fix for a work item
  ipcMain.on(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_START,
    async (_, projectId: string, workItemId: number) => {
      debugLog('startAutoFix handler called', { projectId, workItemId });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          await startAutoFix(project, workItemId, mainWindow);
        });
      } catch (error) {
        debugLog('Auto-fix failed', { workItemId, error: error instanceof Error ? error.message : error });
        sendError(mainWindow, projectId, error instanceof Error ? error.message : 'Failed to start auto-fix');
      }
    }
  );

  // Get batches for a project
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_GET_BATCHES,
    async (_, projectId: string): Promise<AzureDevOpsWorkItemBatch[]> => {
      debugLog('getBatches handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return getBatches(project);
      });
      return result ?? [];
    }
  );

  // Analyze work items and preview proposed batches (proactive workflow)
  ipcMain.on(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW,
    async (_, projectId: string, workItemIds?: number[], maxWorkItems?: number) => {
      debugLog('analyzePreview handler called', { projectId, workItemIds, maxWorkItems });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const adoConfig = await getAzureDevOpsConfig(project);
          if (!adoConfig) {
            throw new Error('No Azure DevOps configuration found');
          }

          mainWindow.webContents.send(
            IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW_PROGRESS,
            projectId,
            { phase: 'analyzing', progress: 10, message: 'Fetching work items for analysis...' }
          );

          const encodedProject = encodeProjectName(adoConfig.project);
          const limit = maxWorkItems ?? 50;

          // Fetch work items using WIQL
          const wiqlQuery = {
            query: "Select [System.Id], [System.Title], [System.Tags] From WorkItems Where [System.TeamProject] = @project AND [System.State] <> 'Closed'",
          };

          const result = await azureDevOpsFetch(
            adoConfig.pat,
            adoConfig.organization,
            `/wit/wiql?api-version=7.0`,
            {
              method: 'POST',
              body: JSON.stringify(wiqlQuery),
            }
          ) as { workItems: Array<{ id: number; title?: string }> };

          let workItems = result.workItems || [];

          // Filter by workItemIds if provided
          const filteredWorkItems = workItemIds && workItemIds.length > 0
            ? workItems.filter(w => workItemIds.includes(w.id))
            : workItems.slice(0, limit);

          mainWindow.webContents.send(
            IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW_PROGRESS,
            projectId,
            { phase: 'analyzing', progress: 50, message: `Analyzing ${filteredWorkItems.length} work items...` }
          );

          // Fetch full details for each work item
          const detailedWorkItems = [];
          for (const workItem of filteredWorkItems) {
            try {
              const details = await azureDevOpsFetch(
                adoConfig.pat,
                adoConfig.organization,
                `/wit/workitems/${workItem.id}?api-version=7.0`
              ) as {
                id: number;
                fields?: Record<string, unknown>;
              };

              const title = (details.fields?.['System.Title'] as string) || '';
              const tags = ((details.fields?.['System.Tags'] as string) || '').split(';').filter(t => t.trim());

              detailedWorkItems.push({
                id: workItem.id,
                title,
                tags,
              });
            } catch {
              // Skip work items that fail to fetch
            }
          }

          // Simple grouping for now - in production this would use AI to group similar work items
          const result_: AzureDevOpsAnalyzePreviewResult = {
            success: true,
            totalWorkItems: workItems.length,
            analyzedWorkItems: detailedWorkItems.length,
            alreadyBatched: 0,
            proposedBatches: [],
            singleWorkItems: detailedWorkItems.map(w => ({
              id: w.id,
              title: w.title,
              tags: w.tags,
            })),
            message: `Found ${detailedWorkItems.length} work items to analyze`,
          };

          mainWindow.webContents.send(
            IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW_COMPLETE,
            projectId,
            result_
          );
        });
      } catch (error) {
        debugLog('Analyze preview failed', { error: error instanceof Error ? error.message : error });
        mainWindow.webContents.send(
          IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW_ERROR,
          projectId,
          error instanceof Error ? error.message : 'Failed to analyze work items'
        );
      }
    }
  );

  // Approve and execute selected batches
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_APPROVE_BATCHES,
    async (_, projectId: string, approvedBatches: AzureDevOpsWorkItemBatch[]): Promise<{ success: boolean; batches?: AzureDevOpsWorkItemBatch[]; error?: string }> => {
      debugLog('approveBatches handler called', { projectId, batchCount: approvedBatches.length });
      const result = await withProjectOrNull(projectId, async (project) => {
        try {
          const batchesDir = path.join(getAzureDevOpsDir(project), 'batches');
          fs.mkdirSync(batchesDir, { recursive: true });

          // Save approved batches
          for (const batch of approvedBatches) {
            const batchFile = path.join(batchesDir, `batch_${batch.id}.json`);
            fs.writeFileSync(batchFile, JSON.stringify({
              batch_id: batch.id,
              work_items: batch.workItems.map(w => ({
                id: w.id,
                title: w.title,
                similarity: w.similarity,
              })),
              common_themes: batch.commonThemes,
              confidence: batch.confidence,
              reasoning: batch.reasoning,
              status: 'pending',
              created_at: new Date().toISOString(),
            }, null, 2), 'utf-8');
          }

          const batches = getBatches(project);
          return { success: true, batches };
        } catch (error) {
          debugLog('Approve batches failed', { error: error instanceof Error ? error.message : error });
          return { success: false, error: error instanceof Error ? error.message : 'Failed to approve batches' };
        }
      });
      return result ?? { success: false, error: 'Project not found' };
    }
  );

  debugLog('AutoFix handlers registered');
}
