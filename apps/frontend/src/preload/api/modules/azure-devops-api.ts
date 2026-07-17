import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  AzureDevOpsWorkItem,
  AzureDevOpsComment,
  AzureDevOpsProject,
  AzureDevOpsSyncStatus,
  AzureDevOpsImportResult,
  AzureDevOpsInvestigationStatus,
  AzureDevOpsInvestigationResult,
  AzureDevOpsPullRequest,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, sendIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * Azure DevOps PR Review Finding
 */
export interface AzureDevOpsPRReviewFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'quality' | 'style' | 'test' | 'docs' | 'pattern' | 'performance';
  title: string;
  description: string;
  file: string;
  line: number;
  endLine?: number;
  suggestedFix?: string;
  fixable: boolean;
}

/**
 * Azure DevOps PR Review Result
 */
export interface AzureDevOpsPRReviewResult {
  pullRequestId: number;
  project: string;
  success: boolean;
  findings: AzureDevOpsPRReviewFinding[];
  summary: string;
  overallStatus: 'approve' | 'request_changes' | 'comment';
  reviewedAt: string;
  reviewedCommitSha?: string;
  isFollowupReview?: boolean;
  previousReviewId?: number;
  resolvedFindings?: string[];
  unresolvedFindings?: string[];
  newFindingsSinceLastReview?: string[];
  hasPostedFindings?: boolean;
  postedFindingIds?: string[];
}

/**
 * Azure DevOps PR Review Progress
 */
export interface AzureDevOpsPRReviewProgress {
  phase: 'fetching' | 'analyzing' | 'generating' | 'posting' | 'complete';
  pullRequestId: number;
  progress: number;
  message: string;
}

/**
 * Azure DevOps PR New Commits Check
 */
export interface AzureDevOpsPRNewCommitsCheck {
  hasNewCommits: boolean;
  currentSha?: string;
  reviewedSha?: string;
  newCommitCount?: number;
}

/**
 * Azure DevOps Auto-Fix Config
 */
export interface AzureDevOpsAutoFixConfig {
  enabled: boolean;
  tags: string[];
  requireHumanApproval: boolean;
  model: string;
  thinkingLevel: string;
}

/**
 * Azure DevOps Auto-Fix Queue Item
 */
export interface AzureDevOpsAutoFixQueueItem {
  workItemId: number;
  project: string;
  status: 'pending' | 'analyzing' | 'creating_spec' | 'building' | 'qa_review' | 'pr_created' | 'completed' | 'failed';
  specId?: string;
  pullRequestId?: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

/**
 * Azure DevOps Issue Batch
 */
export interface AzureDevOpsWorkItemBatch {
  id: string;
  workItems: Array<{ id: number; title: string; similarity: number }>;
  commonThemes: string[];
  confidence: number;
  reasoning: string;
}

/**
 * Azure DevOps Auto-Fix Progress
 */
export interface AzureDevOpsAutoFixProgress {
  phase: 'checking' | 'fetching' | 'analyzing' | 'batching' | 'creating_spec' | 'building' | 'qa_review' | 'creating_pr' | 'complete';
  workItemId: number;
  progress: number;
  message: string;
}

/**
 * Azure DevOps Analyze Preview Result
 */
export interface AzureDevOpsAnalyzePreviewResult {
  success: boolean;
  totalWorkItems: number;
  analyzedWorkItems: number;
  alreadyBatched: number;
  proposedBatches: Array<{
    primaryWorkItemId: number;
    workItems: Array<{
      id: number;
      title: string;
      tags: string[];
      similarityToPrimary: number;
    }>;
    workItemCount: number;
    commonThemes: string[];
    validated: boolean;
    confidence: number;
    reasoning: string;
    theme: string;
  }>;
  singleWorkItems: Array<{
    id: number;
    title: string;
    tags: string[];
  }>;
  message: string;
  error?: string;
}

/**
 * Azure DevOps Triage Category
 */
export type AzureDevOpsTriageCategory = 'bug' | 'feature' | 'documentation' | 'question' | 'duplicate' | 'spam' | 'feature_creep';

/**
 * Azure DevOps Triage Config
 */
export interface AzureDevOpsTriageConfig {
  enabled: boolean;
  duplicateThreshold: number;
  spamThreshold: number;
  featureCreepThreshold: number;
  enableComments: boolean;
}

/**
 * Azure DevOps Triage Result
 */
export interface AzureDevOpsTriageResult {
  workItemId: number;
  category: AzureDevOpsTriageCategory;
  confidence: number;
  tagsToAdd: string[];
  tagsToRemove: string[];
  duplicateOf?: number;
  spamReason?: string;
  featureCreepReason?: string;
  priority: 'high' | 'medium' | 'low';
  comment?: string;
  triagedAt: string;
}

/**
 * Azure DevOps Integration API operations
 */
export interface AzureDevOpsAPI {
  // Project operations
  getAzureDevOpsProjects: (projectId: string) => Promise<IPCResult<AzureDevOpsProject[]>>;
  checkAzureDevOpsConnection: (projectId: string) => Promise<IPCResult<AzureDevOpsSyncStatus>>;

  // Work Item operations
  getAzureDevOpsWorkItems: (projectId: string, state?: string) => Promise<IPCResult<AzureDevOpsWorkItem[]>>;
  getAzureDevOpsWorkItem: (projectId: string, workItemId: number) => Promise<IPCResult<AzureDevOpsWorkItem>>;
  getAzureDevOpsWorkItemComments: (projectId: string, workItemId: number) => Promise<IPCResult<AzureDevOpsComment[]>>;
  investigateAzureDevOpsWorkItem: (projectId: string, workItemId: number, selectedCommentIds?: number[]) => void;
  importAzureDevOpsWorkItems: (projectId: string, workItemIds: number[]) => Promise<IPCResult<AzureDevOpsImportResult>>;

  // Pull Request operations
  getAzureDevOpsPullRequests: (projectId: string, status?: string) => Promise<IPCResult<AzureDevOpsPullRequest[]>>;
  getAzureDevOpsPullRequest: (projectId: string, pullRequestId: number) => Promise<IPCResult<AzureDevOpsPullRequest>>;
  createAzureDevOpsPullRequest: (
    projectId: string,
    options: {
      title: string;
      description?: string;
      sourceBranch: string;
      targetBranch: string;
      labels?: Array<{ id: string; name: string }>;
      reviewerIds?: string[];
    }
  ) => Promise<IPCResult<AzureDevOpsPullRequest>>;
  updateAzureDevOpsPullRequest: (
    projectId: string,
    pullRequestId: number,
    updates: {
      title?: string;
      description?: string;
      targetBranch?: string;
      labels?: Array<{ id: string; name: string }>;
      reviewerIds?: string[];
    }
  ) => Promise<IPCResult<AzureDevOpsPullRequest>>;

  // PR Review operations (AI-powered)
  getAzureDevOpsPRDiff: (projectId: string, pullRequestId: number) => Promise<string | null>;
  getAzureDevOpsPRReview: (projectId: string, pullRequestId: number) => Promise<AzureDevOpsPRReviewResult | null>;
  runAzureDevOpsPRReview: (projectId: string, pullRequestId: number) => void;
  runAzureDevOpsPRFollowupReview: (projectId: string, pullRequestId: number) => void;
  postAzureDevOpsPRReview: (projectId: string, pullRequestId: number, selectedFindingIds?: string[]) => Promise<boolean>;
  postAzureDevOpsPRComment: (projectId: string, pullRequestId: number, body: string) => Promise<boolean>;
  mergeAzureDevOpsPR: (projectId: string, pullRequestId: number, mergeMethod?: 'squash' | 'rebase') => Promise<boolean>;
  assignAzureDevOpsPR: (projectId: string, pullRequestId: number, reviewerIds: string[]) => Promise<boolean>;
  cancelAzureDevOpsPRReview: (projectId: string, pullRequestId: number) => Promise<boolean>;
  checkAzureDevOpsPRNewCommits: (projectId: string, pullRequestId: number) => Promise<AzureDevOpsPRNewCommitsCheck>;

  // PR Review Event Listeners
  onAzureDevOpsPRReviewProgress: (
    callback: (projectId: string, progress: AzureDevOpsPRReviewProgress) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsPRReviewComplete: (
    callback: (projectId: string, result: AzureDevOpsPRReviewResult) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsPRReviewError: (
    callback: (projectId: string, data: { pullRequestId: number; error: string }) => void
  ) => IpcListenerCleanup;

  // Azure DevOps Auto-Fix operations
  getAzureDevOpsAutoFixConfig: (projectId: string) => Promise<AzureDevOpsAutoFixConfig | null>;
  saveAzureDevOpsAutoFixConfig: (projectId: string, config: AzureDevOpsAutoFixConfig) => Promise<boolean>;
  getAzureDevOpsAutoFixQueue: (projectId: string) => Promise<AzureDevOpsAutoFixQueueItem[]>;
  checkAzureDevOpsAutoFixLabels: (projectId: string) => Promise<number[]>;
  checkNewAzureDevOpsAutoFixWorkItems: (projectId: string) => Promise<Array<{ id: number }>>;
  startAzureDevOpsAutoFix: (projectId: string, workItemId: number) => void;
  getAzureDevOpsAutoFixBatches: (projectId: string) => Promise<AzureDevOpsWorkItemBatch[]>;
  analyzeAzureDevOpsAutoFixPreview: (projectId: string, workItemIds?: number[], maxWorkItems?: number) => void;
  approveAzureDevOpsAutoFixBatches: (projectId: string, batches: AzureDevOpsWorkItemBatch[]) => Promise<{ success: boolean; batches?: AzureDevOpsWorkItemBatch[]; error?: string }>;

  // Azure DevOps Auto-Fix Event Listeners
  onAzureDevOpsAutoFixProgress: (
    callback: (projectId: string, progress: AzureDevOpsAutoFixProgress) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsAutoFixComplete: (
    callback: (projectId: string, result: AzureDevOpsAutoFixQueueItem) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsAutoFixError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsAutoFixAnalyzePreviewProgress: (
    callback: (projectId: string, progress: { phase: string; progress: number; message: string }) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsAutoFixAnalyzePreviewComplete: (
    callback: (projectId: string, result: AzureDevOpsAnalyzePreviewResult) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsAutoFixAnalyzePreviewError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;

  // Azure DevOps Triage operations
  getAzureDevOpsTriageConfig: (projectId: string) => Promise<AzureDevOpsTriageConfig | null>;
  saveAzureDevOpsTriageConfig: (projectId: string, config: AzureDevOpsTriageConfig) => Promise<boolean>;
  getAzureDevOpsTriageResults: (projectId: string) => Promise<AzureDevOpsTriageResult[]>;
  runAzureDevOpsTriage: (projectId: string, workItemIds?: number[]) => void;
  applyAzureDevOpsTriageTags: (projectId: string, workItemId: number, tagsToAdd: string[], tagsToRemove: string[]) => Promise<boolean>;

  // Azure DevOps Triage Event Listeners
  onAzureDevOpsTriageProgress: (
    callback: (projectId: string, progress: { phase: string; progress: number; message: string; workItemId?: number }) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsTriageComplete: (
    callback: (projectId: string, results: AzureDevOpsTriageResult[]) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsTriageError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;

  // PAT (Personal Access Token) operations
  savePAT: (organization: string, project: string, pat: string) => Promise<IPCResult<{ success: boolean }>>;
  validatePAT: (organization: string, project: string, pat: string) => Promise<IPCResult<{ valid: boolean; message?: string }>>;

  // User operations
  getAzureDevOpsUser: (organization: string, pat: string) => Promise<IPCResult<{
    user?: { id: string; displayName: string; emailAddress?: string };
    authenticated: boolean;
  }>>;

  // Organization and project detection
  detectAzureDevOpsOrganization: (pat: string) => Promise<IPCResult<{ organization?: string }>>;
  detectAzureDevOpsProject: (organization: string, pat: string) => Promise<IPCResult<{ project?: string }>>;

  // Event Listeners
  onAzureDevOpsInvestigationProgress: (
    callback: (projectId: string, status: AzureDevOpsInvestigationStatus) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsInvestigationComplete: (
    callback: (projectId: string, result: AzureDevOpsInvestigationResult) => void
  ) => IpcListenerCleanup;
  onAzureDevOpsInvestigationError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Azure DevOps Integration API implementation
 */
export const createAzureDevOpsAPI = (): AzureDevOpsAPI => ({
  // Project operations
  getAzureDevOpsProjects: (projectId: string): Promise<IPCResult<AzureDevOpsProject[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_PROJECTS, projectId),

  checkAzureDevOpsConnection: (projectId: string): Promise<IPCResult<AzureDevOpsSyncStatus>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION, projectId),

  // Work Item operations
  getAzureDevOpsWorkItems: (projectId: string, state?: string): Promise<IPCResult<AzureDevOpsWorkItem[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_ISSUES, projectId, state),

  getAzureDevOpsWorkItem: (projectId: string, workItemId: number): Promise<IPCResult<AzureDevOpsWorkItem>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_ISSUE, projectId, workItemId),

  getAzureDevOpsWorkItemComments: (projectId: string, workItemId: number): Promise<IPCResult<AzureDevOpsComment[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_ISSUE_COMMENTS, projectId, workItemId),

  investigateAzureDevOpsWorkItem: (projectId: string, workItemId: number, selectedCommentIds?: number[]): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATE_ISSUE, projectId, workItemId, selectedCommentIds),

  importAzureDevOpsWorkItems: (projectId: string, workItemIds: number[]): Promise<IPCResult<AzureDevOpsImportResult>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_IMPORT_ISSUES, projectId, workItemIds),

  // Pull Request operations
  getAzureDevOpsPullRequests: (projectId: string, status?: string): Promise<IPCResult<AzureDevOpsPullRequest[]>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUESTS, projectId, status),

  getAzureDevOpsPullRequest: (projectId: string, pullRequestId: number): Promise<IPCResult<AzureDevOpsPullRequest>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_PULL_REQUEST, projectId, pullRequestId),

  createAzureDevOpsPullRequest: (
    projectId: string,
    options: {
      title: string;
      description?: string;
      sourceBranch: string;
      targetBranch: string;
      labels?: Array<{ id: string; name: string }>;
      reviewerIds?: string[];
    }
  ): Promise<IPCResult<AzureDevOpsPullRequest>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_CREATE_PULL_REQUEST, projectId, options),

  updateAzureDevOpsPullRequest: (
    projectId: string,
    pullRequestId: number,
    updates: {
      title?: string;
      description?: string;
      targetBranch?: string;
      labels?: Array<{ id: string; name: string }>;
      reviewerIds?: string[];
    }
  ): Promise<IPCResult<AzureDevOpsPullRequest>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_UPDATE_PULL_REQUEST, projectId, pullRequestId, updates),

  // PR Review operations (AI-powered)
  getAzureDevOpsPRDiff: (projectId: string, pullRequestId: number): Promise<string | null> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_DIFF, projectId, pullRequestId),

  getAzureDevOpsPRReview: (projectId: string, pullRequestId: number): Promise<AzureDevOpsPRReviewResult | null> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_GET_REVIEW, projectId, pullRequestId),

  runAzureDevOpsPRReview: (projectId: string, pullRequestId: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW, projectId, pullRequestId),

  runAzureDevOpsPRFollowupReview: (projectId: string, pullRequestId: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_FOLLOWUP_REVIEW, projectId, pullRequestId),

  postAzureDevOpsPRReview: (projectId: string, pullRequestId: number, selectedFindingIds?: string[]): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_POST_REVIEW, projectId, pullRequestId, selectedFindingIds),

  postAzureDevOpsPRComment: (projectId: string, pullRequestId: number, body: string): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_POST_COMMENT, projectId, pullRequestId, body),

  mergeAzureDevOpsPR: (projectId: string, pullRequestId: number, mergeMethod?: 'squash' | 'rebase'): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_MERGE, projectId, pullRequestId, mergeMethod),

  assignAzureDevOpsPR: (projectId: string, pullRequestId: number, reviewerIds: string[]): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_ASSIGN, projectId, pullRequestId, reviewerIds),

  cancelAzureDevOpsPRReview: (projectId: string, pullRequestId: number): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_CANCEL, projectId, pullRequestId),

  checkAzureDevOpsPRNewCommits: (projectId: string, pullRequestId: number): Promise<AzureDevOpsPRNewCommitsCheck> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_PR_CHECK_NEW_COMMITS, projectId, pullRequestId),

  // PR Review Event Listeners
  onAzureDevOpsPRReviewProgress: (
    callback: (projectId: string, progress: AzureDevOpsPRReviewProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS, callback),

  onAzureDevOpsPRReviewComplete: (
    callback: (projectId: string, result: AzureDevOpsPRReviewResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE, callback),

  onAzureDevOpsPRReviewError: (
    callback: (projectId: string, data: { pullRequestId: number; error: string }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR, callback),

  // Azure DevOps Auto-Fix operations
  getAzureDevOpsAutoFixConfig: (projectId: string): Promise<AzureDevOpsAutoFixConfig | null> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_GET_CONFIG, projectId),

  saveAzureDevOpsAutoFixConfig: (projectId: string, config: AzureDevOpsAutoFixConfig): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_SAVE_CONFIG, projectId, config),

  getAzureDevOpsAutoFixQueue: (projectId: string): Promise<AzureDevOpsAutoFixQueueItem[]> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_GET_QUEUE, projectId),

  checkAzureDevOpsAutoFixLabels: (projectId: string): Promise<number[]> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_CHECK_LABELS, projectId),

  checkNewAzureDevOpsAutoFixWorkItems: (projectId: string): Promise<Array<{ id: number }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_CHECK_NEW, projectId),

  startAzureDevOpsAutoFix: (projectId: string, workItemId: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_START, projectId, workItemId),

  getAzureDevOpsAutoFixBatches: (projectId: string): Promise<AzureDevOpsWorkItemBatch[]> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_GET_BATCHES, projectId),

  analyzeAzureDevOpsAutoFixPreview: (projectId: string, workItemIds?: number[], maxWorkItems?: number): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW, projectId, workItemIds, maxWorkItems),

  approveAzureDevOpsAutoFixBatches: (projectId: string, batches: AzureDevOpsWorkItemBatch[]): Promise<{ success: boolean; batches?: AzureDevOpsWorkItemBatch[]; error?: string }> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_APPROVE_BATCHES, projectId, batches),

  // Azure DevOps Auto-Fix Event Listeners
  onAzureDevOpsAutoFixProgress: (
    callback: (projectId: string, progress: AzureDevOpsAutoFixProgress) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_PROGRESS, callback),

  onAzureDevOpsAutoFixComplete: (
    callback: (projectId: string, result: AzureDevOpsAutoFixQueueItem) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_COMPLETE, callback),

  onAzureDevOpsAutoFixError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ERROR, callback),

  onAzureDevOpsAutoFixAnalyzePreviewProgress: (
    callback: (projectId: string, progress: { phase: string; progress: number; message: string }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW_PROGRESS, callback),

  onAzureDevOpsAutoFixAnalyzePreviewComplete: (
    callback: (projectId: string, result: AzureDevOpsAnalyzePreviewResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW_COMPLETE, callback),

  onAzureDevOpsAutoFixAnalyzePreviewError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_ANALYZE_PREVIEW_ERROR, callback),

  // Azure DevOps Triage operations
  getAzureDevOpsTriageConfig: (projectId: string): Promise<AzureDevOpsTriageConfig | null> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_GET_CONFIG, projectId),

  saveAzureDevOpsTriageConfig: (projectId: string, config: AzureDevOpsTriageConfig): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_SAVE_CONFIG, projectId, config),

  getAzureDevOpsTriageResults: (projectId: string): Promise<AzureDevOpsTriageResult[]> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_GET_RESULTS, projectId),

  runAzureDevOpsTriage: (projectId: string, workItemIds?: number[]): void =>
    sendIpc(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_RUN, projectId, workItemIds),

  applyAzureDevOpsTriageTags: (projectId: string, workItemId: number, tagsToAdd: string[], tagsToRemove: string[]): Promise<boolean> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_APPLY_LABELS, projectId, workItemId, tagsToAdd, tagsToRemove),

  // Azure DevOps Triage Event Listeners
  onAzureDevOpsTriageProgress: (
    callback: (projectId: string, progress: { phase: string; progress: number; message: string; workItemId?: number }) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_PROGRESS, callback),

  onAzureDevOpsTriageComplete: (
    callback: (projectId: string, results: AzureDevOpsTriageResult[]) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_COMPLETE, callback),

  onAzureDevOpsTriageError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_ERROR, callback),

  // PAT (Personal Access Token) operations
  savePAT: (organization: string, project: string, pat: string): Promise<IPCResult<{ success: boolean }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_SAVE_PAT, organization, project, pat),

  validatePAT: (organization: string, project: string, pat: string): Promise<IPCResult<{ valid: boolean; message?: string }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_VALIDATE_PAT, organization, project, pat),

  // User operations
  getAzureDevOpsUser: (organization: string, pat: string): Promise<IPCResult<{
    user?: { id: string; displayName: string; emailAddress?: string };
    authenticated: boolean;
  }>> => invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_GET_USER, organization, pat),

  // Organization and project detection
  detectAzureDevOpsOrganization: (pat: string): Promise<IPCResult<{ organization?: string }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_DETECT_ORG, pat),

  detectAzureDevOpsProject: (organization: string, pat: string): Promise<IPCResult<{ project?: string }>> =>
    invokeIpc(IPC_CHANNELS.AZURE_DEVOPS_DETECT_PROJECT, organization, pat),

  // Event Listeners
  onAzureDevOpsInvestigationProgress: (
    callback: (projectId: string, status: AzureDevOpsInvestigationStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_PROGRESS, callback),

  onAzureDevOpsInvestigationComplete: (
    callback: (projectId: string, result: AzureDevOpsInvestigationResult) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_COMPLETE, callback),

  onAzureDevOpsInvestigationError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATION_ERROR, callback)
});
