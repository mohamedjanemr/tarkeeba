/**
 * Azure DevOps spec utilities
 * Handles creating task specs from Azure DevOps work items
 */

import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import path from 'path';
import type { Project } from '../../../shared/types';
import type { AzureDevOpsAPIWorkItem, AzureDevOpsAPICommentBasic, AzureDevOpsConfig } from './types';
import { labelMatchesWholeWord } from '../shared/label-utils';
import { sanitizeText, sanitizeStringArray } from '../shared/sanitize';

/**
 * Simplified task info returned when creating a spec from an Azure DevOps work item.
 * This is not a full Task object - it's just the basic info needed for the UI.
 */
export interface AzureDevOpsTaskInfo {
  id: string;
  specId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

type WorkItemLike = {
  id: number;
  title: string;
  description?: string;
  state: string;
  workItemType: string;
  tags?: string[];
  assignedTo?: { displayName: string };
  createdDate: string;
  changedDate: string;
  webUrl: string;
};

interface SanitizedAzureDevOpsWorkItem {
  id: number;
  title: string;
  description: string;
  state: string;
  workItemType: string;
  tags: string[];
  assignedTo?: { displayName: string };
  createdDate: string;
  changedDate: string;
  webUrl: string;
}

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[Azure DevOps Spec] ${message}`, data);
    } else {
      console.debug(`[Azure DevOps Spec] ${message}`);
    }
  }
}

/**
 * Determine task category based on Azure DevOps work item type and tags
 * Maps to TaskCategory type from shared/types/task.ts
 */
function determineCategoryFromWorkItem(workItemType: string, tags: string[]): 'feature' | 'bug_fix' | 'refactoring' | 'documentation' | 'security' | 'performance' | 'ui_ux' | 'infrastructure' | 'testing' {
  const lowerType = workItemType.toLowerCase();
  const lowerTags = tags.map(t => t.toLowerCase());

  // Check work item type first
  if (lowerType.includes('bug') || lowerType.includes('defect')) {
    return 'bug_fix';
  }

  // Check tags for more specific categorization
  if (lowerTags.some(t => t.includes('bug') || t.includes('defect') || t.includes('error') || t.includes('fix'))) {
    return 'bug_fix';
  }
  if (lowerTags.some(t => t.includes('security') || t.includes('vulnerability') || t.includes('cve'))) {
    return 'security';
  }
  if (lowerTags.some(t => t.includes('performance') || t.includes('optimization') || t.includes('speed'))) {
    return 'performance';
  }
  if (lowerTags.some(t => t.includes('ui') || t.includes('ux') || t.includes('design') || t.includes('styling'))) {
    return 'ui_ux';
  }
  if (lowerTags.some(t =>
    t.includes('infrastructure') ||
    t.includes('devops') ||
    t.includes('deployment') ||
    labelMatchesWholeWord(t, 'ci') ||
    labelMatchesWholeWord(t, 'cd')
  )) {
    return 'infrastructure';
  }
  if (lowerTags.some(t => t.includes('test') || t.includes('testing') || t.includes('qa'))) {
    return 'testing';
  }
  if (lowerTags.some(t => t.includes('refactor') || t.includes('cleanup') || t.includes('maintenance') || t.includes('chore') || t.includes('tech-debt') || t.includes('technical debt'))) {
    return 'refactoring';
  }
  if (lowerTags.some(t => t.includes('documentation') || t.includes('docs'))) {
    return 'documentation';
  }

  // Default based on work item type
  if (lowerType.includes('task')) {
    return 'feature';
  }
  return 'feature';
}

function sanitizeWorkItemId(value: unknown): number {
  const itemId = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return 0;
  }
  return itemId;
}

function sanitizeWorkItemState(value: unknown): string {
  if (typeof value !== 'string') {
    return 'New';
  }
  return value.trim() || 'New';
}

function sanitizeWorkItemType(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Task';
  }
  return value.trim() || 'Task';
}

function sanitizeAssignee(value: unknown): { displayName: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const displayName = sanitizeText((value as { displayName?: unknown }).displayName, 100);
  return displayName ? { displayName } : undefined;
}

function sanitizeIsoDate(value: unknown): string {
  if (typeof value !== 'string') {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sanitizeWorkItemUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '';
  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return '';
    // Reject URLs with embedded credentials (security risk)
    if (parsedUrl.username || parsedUrl.password) return '';
    return parsedUrl.toString();
  } catch {
    return '';
  }
}

function sanitizeOrganizationUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function sanitizeWorkItemForSpec(workItem: WorkItemLike): SanitizedAzureDevOpsWorkItem {
  const id = sanitizeWorkItemId(workItem.id);
  const title = sanitizeText(workItem.title, 200) || `Work Item ${id || 'unknown'}`;
  return {
    id,
    title,
    description: sanitizeText(workItem.description ?? '', 20000, true),
    state: sanitizeWorkItemState(workItem.state),
    workItemType: sanitizeWorkItemType(workItem.workItemType),
    tags: sanitizeStringArray(workItem.tags, 50, 100),
    assignedTo: sanitizeAssignee(workItem.assignedTo),
    createdDate: sanitizeIsoDate(workItem.createdDate),
    changedDate: sanitizeIsoDate(workItem.changedDate),
    webUrl: sanitizeWorkItemUrl(workItem.webUrl),
  };
}

/**
 * Generate a spec directory name from work item title
 */
function generateSpecDirName(workItemId: number, title: string): string {
  // Clean title for directory name
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);

  // Format: 001-work-item-title (padded work item ID)
  const paddedId = String(workItemId).padStart(3, '0');
  return `${paddedId}-${cleanTitle}`;
}

/**
 * Build work item context for spec creation
 */
export function buildWorkItemContext(
  workItem: WorkItemLike,
  organization: string,
  project: string,
  comments?: AzureDevOpsAPICommentBasic[]
): string {
  const lines: string[] = [];
  const safeOrganization = sanitizeText(organization, 200);
  const safeProject = sanitizeText(project, 200);
  const safeWorkItem = sanitizeWorkItemForSpec(workItem);

  lines.push(`# Azure DevOps Work Item #${safeWorkItem.id}: ${safeWorkItem.title}`);
  lines.push('');
  lines.push(`**Organization:** ${safeOrganization}`);
  lines.push(`**Project:** ${safeProject}`);
  lines.push(`**Type:** ${safeWorkItem.workItemType}`);
  lines.push(`**State:** ${safeWorkItem.state}`);
  lines.push(`**Created:** ${new Date(safeWorkItem.createdDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`);

  if (safeWorkItem.tags.length > 0) {
    lines.push(`**Tags:** ${safeWorkItem.tags.join(', ')}`);
  }

  if (safeWorkItem.assignedTo) {
    lines.push(`**Assigned To:** ${safeWorkItem.assignedTo.displayName}`);
  }

  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(safeWorkItem.description || '_No description provided_');
  lines.push('');
  lines.push(`**Web URL:** ${safeWorkItem.webUrl}`);

  // Add comments section if comments are provided
  if (comments && comments.length > 0) {
    lines.push('');
    lines.push(`## Comments (${comments.length})`);
    lines.push('');
    for (const comment of comments) {
      const safeAuthor = sanitizeText(comment.author?.displayName || 'unknown', 100);
      const safeContent = sanitizeText(comment.content, 20000, true);
      lines.push(`**${safeAuthor}:** ${safeContent}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Check if a path exists (async)
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches all comments for an Azure DevOps work item with pagination.
 * Handles rate limiting and authentication errors gracefully.
 *
 * @param config Azure DevOps configuration with PAT and organization
 * @param project Project name or ID
 * @param workItemId Work item ID to fetch comments for
 * @returns Array of basic comment objects with id, content, and author
 */
export async function fetchAllWorkItemComments(
  config: { pat: string; organization: string },
  project: string,
  workItemId: number
): Promise<AzureDevOpsAPICommentBasic[]> {
  const { azureDevOpsFetch } = await import('./utils');
  const { AzureDevOpsAPIError } = await import('./utils');

  const allComments: AzureDevOpsAPICommentBasic[] = [];
  let continuationToken: string | undefined = undefined;
  const MAX_ITERATIONS = 50; // Safety limit: max 5000 comments with default page size
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    try {
      const endpoint = `/wit/workitems/${workItemId}/comments`;
      const params = new URLSearchParams();
      if (continuationToken) {
        params.append('continuationToken', continuationToken);
      }
      const queryString = params.toString();
      const fullEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;

      const response = await azureDevOpsFetch(
        config.pat,
        config.organization,
        fullEndpoint
      ) as { value?: unknown[]; continuationToken?: string };

      // Runtime validation: ensure we got an array
      if (!response.value || !Array.isArray(response.value)) {
        debugLog('Azure DevOps comments API returned invalid response, stopping pagination');
        break;
      }

      if (response.value.length === 0) {
        break;
      } else {
        // Extract only needed fields with null-safe defaults
        const commentSummaries: AzureDevOpsAPICommentBasic[] = response.value
          .filter((comment: unknown): comment is Record<string, unknown> =>
            comment !== null && typeof comment === 'object' && typeof (comment as Record<string, unknown>).id === 'number'
          )
          .map((comment) => {
            // Validate author structure defensively
            const author = comment.author;
            const displayName = (author !== null && typeof author === 'object' && typeof (author as Record<string, unknown>).displayName === 'string')
              ? (author as Record<string, unknown>).displayName as string
              : 'unknown';
            return {
              id: comment.id as number,
              content: (comment.content as string | undefined) || '',
              author: { displayName },
            };
          });
        allComments.push(...commentSummaries);

        // Check for continuation token
        if (response.continuationToken) {
          continuationToken = response.continuationToken;
        } else {
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for authentication/rate-limit errors using structured status codes
      const isAuthError = error instanceof AzureDevOpsAPIError && (error.statusCode === 401 || error.statusCode === 403);
      const isRateLimited = error instanceof AzureDevOpsAPIError && error.statusCode === 429;

      if (isAuthError || isRateLimited) {
        // Re-throw critical errors to let the caller surface them to the user
        const statusCode = error instanceof AzureDevOpsAPIError ? error.statusCode : undefined;
        console.warn(`[Azure DevOps Comments] ${isAuthError ? 'Authentication' : 'Rate limit'} error during comments fetch`, { iteration: iterations, error: errorMessage, statusCode });
        throw error;
      }

      // For transient errors on first iteration, warn the user but continue
      if (iterations === 1 && allComments.length === 0) {
        console.warn('[Azure DevOps Comments] Failed to fetch any comments, proceeding without comments context', { error: errorMessage });
      } else {
        // Log pagination failure for subsequent iterations
        debugLog('Failed to fetch comments, using partial comments', { iteration: iterations, error: errorMessage, commentsRetrieved: allComments.length });
      }
      break;
    }
  }

  // Warn if we hit the iteration limit
  if (iterations >= MAX_ITERATIONS && continuationToken) {
    debugLog('Pagination limit reached, some comments may be missing', { maxIterations: MAX_ITERATIONS, commentsRetrieved: allComments.length });
  }

  return allComments;
}

/**
 * Create a task spec from an Azure DevOps work item
 */
export async function createSpecForWorkItem(
  project: Project,
  workItem: AzureDevOpsAPIWorkItem,
  config: AzureDevOpsConfig,
  baseBranch?: string,
  comments?: AzureDevOpsAPICommentBasic[]
): Promise<AzureDevOpsTaskInfo | null> {
  try {
    // Validate and sanitize network data before writing to disk
    const safeWorkItem = sanitizeWorkItemForSpec(workItem);
    if (!safeWorkItem.id) {
      debugLog('Skipping work item with invalid ID', { id: workItem.id });
      return null;
    }
    const safeOrganization = sanitizeText(config.organization, 200);
    const safeProject = sanitizeText(config.project, 200);

    const specsDir = path.join(project.path, project.autoBuildPath, 'specs');

    // Ensure specs directory exists
    await mkdir(specsDir, { recursive: true });

    // Generate spec directory name
    const specDirName = generateSpecDirName(safeWorkItem.id, safeWorkItem.title);
    const specDir = path.join(specsDir, specDirName);
    const metadataPath = path.join(specDir, 'metadata.json');

    // Check if spec already exists
    if (await pathExists(specDir)) {
      debugLog('Spec already exists for work item:', { id: safeWorkItem.id, specDir });

      // Read existing metadata for accurate timestamps
      let createdAt = new Date(safeWorkItem.createdDate);
      let updatedAt = createdAt;

      if (await pathExists(metadataPath)) {
        try {
          const metadataContent = await readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent);
          if (metadata.createdAt) {
            createdAt = new Date(metadata.createdAt);
          }
          // Use file modification time for updatedAt
          const stats = await stat(metadataPath);
          updatedAt = new Date(stats.mtimeMs);
        } catch {
          // Fallback to work item dates if metadata read fails
        }
      }

      // Return existing task info
      return {
        id: specDirName,
        specId: specDirName,
        title: safeWorkItem.title,
        description: safeWorkItem.description || '',
        createdAt,
        updatedAt
      };
    }

    // Create spec directory
    await mkdir(specDir, { recursive: true });

    // Create TASK.md with work item context (including selected comments)
    const taskContent = buildWorkItemContext(safeWorkItem, safeOrganization, safeProject, comments);
    await writeFile(path.join(specDir, 'TASK.md'), taskContent, 'utf-8');

    // Create metadata.json (legacy format for Azure DevOps-specific data)
    const metadata = {
      source: 'azure-devops',
      azureDevOps: {
        workItemId: safeWorkItem.id,
        organization: safeOrganization,
        project: safeProject,
        webUrl: safeWorkItem.webUrl,
        state: safeWorkItem.state,
        workItemType: safeWorkItem.workItemType,
        tags: safeWorkItem.tags,
        createdDate: safeWorkItem.createdDate
      },
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Create task_metadata.json (consistent with GitHub format for backend compatibility)
    const taskMetadata = {
      sourceType: 'azure-devops' as const,
      azureDevOpsWorkItemId: safeWorkItem.id,
      azureDevOpsUrl: safeWorkItem.webUrl,
      category: determineCategoryFromWorkItem(safeWorkItem.workItemType, safeWorkItem.tags || []),
      // Store baseBranch for worktree creation and QA comparison
      ...(baseBranch && { baseBranch })
    };
    await writeFile(
      path.join(specDir, 'task_metadata.json'),
      JSON.stringify(taskMetadata, null, 2),
      'utf-8'
    );

    debugLog('Created spec for work item:', { id: safeWorkItem.id, specDir });

    // Return task info
    return {
      id: specDirName,
      specId: specDirName,
      title: safeWorkItem.title,
      description: safeWorkItem.description || '',
      createdAt: new Date(safeWorkItem.createdDate),
      updatedAt: new Date()
    };
  } catch (error) {
    debugLog('Failed to create spec for work item:', { id: workItem.id, error });
    return null;
  }
}
