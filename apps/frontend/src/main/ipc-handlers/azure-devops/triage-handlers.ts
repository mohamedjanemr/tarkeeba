/**
 * Azure DevOps Triage IPC handlers
 *
 * Handles automatic triage of Azure DevOps work items by:
 * 1. Categorizing work items (bug, feature, documentation, etc.)
 * 2. Detecting duplicates, spam, and scope creep
 * 3. Applying tags automatically
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
  AzureDevOpsTriageConfig,
  AzureDevOpsTriageResult,
  AzureDevOpsTriageCategory,
} from './types';
import { sanitizeStringArray } from '../shared/sanitize';

// Debug logging
function debugLog(message: string, ...args: unknown[]): void {
  console.log(`[Azure DevOps Triage] ${message}`, ...args);
}

const TRIAGE_CATEGORIES: AzureDevOpsTriageCategory[] = [
  'bug',
  'feature',
  'documentation',
  'question',
  'duplicate',
  'spam',
  'scope_creep',
];

function sanitizeWorkItemId(value: unknown): number | null {
  const workItemId = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(workItemId) || workItemId <= 0) {
    return null;
  }
  return workItemId;
}

function sanitizeCategory(value: unknown): AzureDevOpsTriageCategory {
  return TRIAGE_CATEGORIES.includes(value as AzureDevOpsTriageCategory) ? (value as AzureDevOpsTriageCategory) : 'feature';
}

function sanitizeTags(values: string[]): string[] {
  return sanitizeStringArray(values, 50, 50);
}

function sanitizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sanitizePriority(value: unknown): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'low') return value;
  return 'medium';
}

function sanitizeTriagedAt(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sanitizeTriageResult(result: AzureDevOpsTriageResult): {
  work_item_id: number;
  category: AzureDevOpsTriageCategory;
  confidence: number;
  tags_to_add: string[];
  tags_to_remove: string[];
  priority: 'high' | 'medium' | 'low';
  triaged_at: string;
} | null {
  const workItemId = sanitizeWorkItemId(result.workItemId);
  if (!workItemId) return null;
  return {
    work_item_id: workItemId,
    category: sanitizeCategory(result.category),
    confidence: sanitizeConfidence(result.confidence),
    tags_to_add: sanitizeTags(result.tagsToAdd),
    tags_to_remove: sanitizeTags(result.tagsToRemove),
    priority: sanitizePriority(result.priority),
    triaged_at: sanitizeTriagedAt(result.triagedAt),
  };
}

/**
 * Get the Azure DevOps directory for a project
 */
function getAzureDevOpsDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'azure-devops');
}

/**
 * Get the triage config for a project
 */
function getTriageConfig(project: Project): AzureDevOpsTriageConfig {
  const configPath = path.join(getAzureDevOpsDir(project), 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        enabled: data.triage_enabled ?? false,
        duplicateThreshold: data.duplicate_threshold ?? 0.85,
        spamThreshold: data.spam_threshold ?? 0.9,
        scopeCreepThreshold: data.scope_creep_threshold ?? 0.8,
        enableComments: data.triage_enable_comments ?? true,
      };
    } catch {
      // Return defaults
    }
  }

  return {
    enabled: false,
    duplicateThreshold: 0.85,
    spamThreshold: 0.9,
    scopeCreepThreshold: 0.8,
    enableComments: true,
  };
}

/**
 * Save the triage config for a project
 */
function saveTriageConfig(project: Project, config: AzureDevOpsTriageConfig): void {
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
    triage_enabled: config.enabled,
    duplicate_threshold: config.duplicateThreshold,
    spam_threshold: config.spamThreshold,
    scope_creep_threshold: config.scopeCreepThreshold,
    triage_enable_comments: config.enableComments,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

/**
 * Get triage results for a project
 */
function getTriageResults(project: Project): AzureDevOpsTriageResult[] {
  const triageDir = path.join(getAzureDevOpsDir(project), 'triage');

  if (!fs.existsSync(triageDir)) {
    return [];
  }

  const results: AzureDevOpsTriageResult[] = [];
  const files = fs.readdirSync(triageDir);

  for (const file of files) {
    if (file.startsWith('triage_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(triageDir, file), 'utf-8'));
        results.push({
          workItemId: data.work_item_id,
          category: data.category as AzureDevOpsTriageCategory,
          confidence: data.confidence,
          tagsToAdd: data.tags_to_add ?? [],
          tagsToRemove: data.tags_to_remove ?? [],
          duplicateOf: data.duplicate_of,
          spamReason: data.spam_reason,
          scopeCreepReason: data.scope_creep_reason,
          priority: data.priority,
          comment: data.comment,
          triagedAt: data.triaged_at,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return results.sort((a, b) => new Date(b.triagedAt).getTime() - new Date(a.triagedAt).getTime());
}

/**
 * Apply tags to a work item
 */
async function applyTags(
  project: Project,
  workItemId: number,
  tagsToAdd: string[],
  tagsToRemove: string[]
): Promise<boolean> {
  const adoConfig = await getAzureDevOpsConfig(project);
  if (!adoConfig) {
    throw new Error('No Azure DevOps configuration found');
  }

  const encodedProject = encodeProjectName(adoConfig.project);

  // Get current work item to retrieve existing tags
  const workItem = await azureDevOpsFetch(
    adoConfig.pat,
    adoConfig.organization,
    `/wit/workitems/${workItemId}?$expand=relations&api-version=7.0`
  ) as { fields?: Record<string, unknown> };

  // Azure DevOps uses fields['System.Tags'] for tags
  const currentTags = (workItem.fields?.['System.Tags'] as string) || '';
  const tagSet = new Set(currentTags.split(';').filter(t => t.trim()));

  // Remove tags
  for (const tag of tagsToRemove) {
    tagSet.delete(tag);
  }

  // Add tags
  for (const tag of tagsToAdd) {
    tagSet.add(tag);
  }

  // Update work item with new tags
  await azureDevOpsFetch(
    adoConfig.pat,
    adoConfig.organization,
    `/wit/workitems/${workItemId}?api-version=7.0`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json-patch+json',
      },
      body: JSON.stringify([
        {
          op: 'replace',
          path: '/fields/System.Tags',
          value: Array.from(tagSet).join(';'),
        },
      ]),
    }
  );

  return true;
}

/**
 * Send IPC progress event
 */
function sendProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  progress: { phase: string; progress: number; message: string; workItemId?: number }
): void {
  mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_PROGRESS, projectId, progress);
}

/**
 * Send IPC error event
 */
function sendError(
  mainWindow: BrowserWindow,
  projectId: string,
  error: string
): void {
  mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_ERROR, projectId, error);
}

/**
 * Send IPC complete event
 */
function sendComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  results: AzureDevOpsTriageResult[]
): void {
  mainWindow.webContents.send(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_COMPLETE, projectId, results);
}

/**
 * Register triage related handlers
 */
export function registerTriageHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering Triage handlers');

  // Get triage config
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_GET_CONFIG,
    async (_, projectId: string): Promise<AzureDevOpsTriageConfig | null> => {
      debugLog('getTriageConfig handler called', { projectId });
      return withProjectOrNull(projectId, async (project) => {
        return getTriageConfig(project);
      });
    }
  );

  // Save triage config
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_SAVE_CONFIG,
    async (_, projectId: string, config: AzureDevOpsTriageConfig): Promise<boolean> => {
      debugLog('saveTriageConfig handler called', { projectId, enabled: config.enabled });
      const result = await withProjectOrNull(projectId, async (project) => {
        saveTriageConfig(project, config);
        return true;
      });
      return result ?? false;
    }
  );

  // Get triage results
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_GET_RESULTS,
    async (_, projectId: string): Promise<AzureDevOpsTriageResult[]> => {
      debugLog('getTriageResults handler called', { projectId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return getTriageResults(project);
      });
      return result ?? [];
    }
  );

  // Run triage on work items
  ipcMain.on(
    IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_RUN,
    async (_, projectId: string, workItemIds?: number[]) => {
      debugLog('runTriage handler called', { projectId, workItemIds });
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

          sendProgress(mainWindow, projectId, {
            phase: 'fetching',
            progress: 10,
            message: 'Fetching work items for triage...',
          });

          const encodedProject = encodeProjectName(adoConfig.project);

          // Fetch work items - using WIQL (Work Item Query Language)
          const wiqlQuery = {
            query: "Select [System.Id], [System.Title], [System.Description], [System.Tags] From WorkItems Where [System.TeamProject] = @project AND [System.State] <> 'Closed'",
          };

          const result = await azureDevOpsFetch(
            adoConfig.pat,
            adoConfig.organization,
            `/wit/wiql?api-version=7.0`,
            {
              method: 'POST',
              body: JSON.stringify(wiqlQuery),
            }
          ) as { workItems: Array<{ id: number; url: string }> };

          const workItems = result.workItems || [];

          // Filter by workItemIds if provided
          const filteredWorkItems = workItemIds && workItemIds.length > 0
            ? workItems.filter(w => workItemIds.includes(w.id))
            : workItems;

          sendProgress(mainWindow, projectId, {
            phase: 'analyzing',
            progress: 30,
            message: `Analyzing ${filteredWorkItems.length} work items...`,
          });

          // Simple triage logic (in production, this would use AI)
          const triageDir = path.join(getAzureDevOpsDir(project), 'triage');
          fs.mkdirSync(triageDir, { recursive: true });

          const results: AzureDevOpsTriageResult[] = [];

          for (let i = 0; i < filteredWorkItems.length; i++) {
            const workItem = filteredWorkItems[i];
            const progress = 30 + Math.floor((i / filteredWorkItems.length) * 60);

            sendProgress(mainWindow, projectId, {
              phase: 'analyzing',
              progress,
              message: `Triaging work item #${workItem.id}...`,
              workItemId: workItem.id,
            });

            // Fetch full work item details
            const details = await azureDevOpsFetch(
              adoConfig.pat,
              adoConfig.organization,
              `/wit/workitems/${workItem.id}?api-version=7.0`
            ) as {
              id: number;
              fields?: Record<string, unknown>;
            };

            const title = (details.fields?.['System.Title'] as string) || '';
            const description = (details.fields?.['System.Description'] as string) || '';

            // Simple category detection based on title/description
            let category: AzureDevOpsTriageCategory = 'feature';
            const titleLower = title.toLowerCase();
            const descLower = description.toLowerCase();

            if (titleLower.includes('bug') || titleLower.includes('fix') || titleLower.includes('error')) {
              category = 'bug';
            } else if (titleLower.includes('doc') || descLower.includes('documentation')) {
              category = 'documentation';
            } else if (titleLower.includes('question') || titleLower.includes('?')) {
              category = 'question';
            }

            const workItemId = sanitizeWorkItemId(workItem.id);
            if (!workItemId) {
              debugLog('Skipping work item with invalid ID', { workItemId: workItem.id });
              continue;
            }

            const triageResult: AzureDevOpsTriageResult = {
              workItemId,
              category,
              confidence: 0.75,
              tagsToAdd: [category],
              tagsToRemove: [],
              priority: 'medium',
              triagedAt: new Date().toISOString(),
            };

            const sanitizedResult = sanitizeTriageResult(triageResult);
            if (!sanitizedResult) {
              debugLog('Skipping triage result with invalid ID', { workItemId: triageResult.workItemId });
              continue;
            }

            // Save result
            // lgtm[js/http-to-file-access] - triageDir from controlled project path, work_item_id is numeric
            fs.writeFileSync(
              path.join(triageDir, `triage_${sanitizedResult.work_item_id}.json`),
              JSON.stringify(sanitizedResult, null, 2),
              'utf-8'
            );

            results.push(triageResult);
          }

          sendProgress(mainWindow, projectId, {
            phase: 'complete',
            progress: 100,
            message: `Triaged ${results.length} work items`,
          });

          sendComplete(mainWindow, projectId, results);
        });
      } catch (error) {
        debugLog('Triage failed', { error: error instanceof Error ? error.message : error });
        sendError(mainWindow, projectId, error instanceof Error ? error.message : 'Failed to run triage');
      }
    }
  );

  // Apply triage labels (tags in Azure DevOps)
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_APPLY_LABELS,
    async (_, projectId: string, workItemId: number, tagsToAdd: string[], tagsToRemove: string[]): Promise<boolean> => {
      debugLog('applyTags handler called', { projectId, workItemId });
      const result = await withProjectOrNull(projectId, async (project) => {
        return applyTags(project, workItemId, tagsToAdd, tagsToRemove);
      });
      return result ?? false;
    }
  );

  debugLog('Triage handlers registered');
}
