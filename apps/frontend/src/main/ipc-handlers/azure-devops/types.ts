/**
 * Azure DevOps module types and interfaces
 */

export interface AzureDevOpsConfig {
  pat: string; // Personal Access Token
  organization: string; // e.g., "myorg" or "https://dev.azure.com/myorg"
  project: string; // Project name or ID
}

export interface AzureDevOpsAPIProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  defaultTeamImageUrl?: string;
  defaultTeam?: { id: string; name: string };
  visibility: 'private' | 'public';
}

export interface AzureDevOpsAPIWorkItem {
  id: number;
  rev: number;
  title: string;
  description?: string;
  state: string; // e.g., 'New', 'Active', 'Closed', 'Done'
  workItemType: string; // e.g., 'Bug', 'Feature', 'Task', 'User Story'
  tags?: string[];
  assignedTo?: { displayName: string; uniqueName: string; imageUrl?: string };
  createdBy: { displayName: string; uniqueName: string; imageUrl?: string };
  createdDate: string;
  changedDate: string;
  closedDate?: string;
  commentCount?: number;
  url: string;
  webUrl: string;
  fields?: Record<string, unknown>;
}

export interface AzureDevOpsAPIComment {
  id: number;
  content: string;
  author: { displayName: string; uniqueName: string; imageUrl?: string };
  createdDate: string;
  modifiedDate: string;
  isDeleted: boolean;
  url: string;
}

export interface AzureDevOpsAPICommentBasic {
  id: number;
  content: string;
  author: { displayName: string };
}

export interface AzureDevOpsAPIPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: 'abandoned' | 'active' | 'completed';
  sourceRefName: string; // Branch name (e.g., "refs/heads/feature")
  targetRefName: string; // Branch name (e.g., "refs/heads/main")
  createdBy: { displayName: string; uniqueName: string; imageUrl?: string };
  reviewers: Array<{ displayName: string; uniqueName: string; imageUrl?: string; vote: number }>;
  labels?: Array<{ id: string; name: string }>;
  url: string;
  creationDate: string;
  closedDate?: string;
}

export interface AzureDevOpsAPITeam {
  id: string;
  name: string;
  description?: string;
  url: string;
  imageUrl?: string;
}

export interface AzureDevOpsAPIUser {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
  url: string;
}

export interface AzureDevOpsReleaseOptions {
  description?: string;
  tag?: string;
  isDraft?: boolean;
}

export interface CreatePullRequestOptions {
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
  labels?: string[];
  reviewerIds?: string[];
  isDraft?: boolean;
}

// ============================================
// PR Review Types
// ============================================

export interface PRReviewFinding {
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

export interface PRReviewResult {
  prId: number;
  project: string;
  success: boolean;
  findings: PRReviewFinding[];
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

export interface PRReviewProgress {
  phase: 'fetching' | 'analyzing' | 'generating' | 'posting' | 'complete';
  prId: number;
  progress: number;
  message: string;
}

export interface NewCommitsCheck {
  hasNewCommits: boolean;
  currentSha?: string;
  reviewedSha?: string;
  newCommitCount?: number;
}

// ============================================
// Auto-Fix Types
// ============================================

export interface AzureDevOpsAutoFixConfig {
  enabled: boolean;
  labels: string[];
  requireHumanApproval: boolean;
  model: string;
  thinkingLevel: string;
}

export interface AzureDevOpsAutoFixQueueItem {
  workItemId: number;
  project: string;
  status: 'pending' | 'analyzing' | 'creating_spec' | 'building' | 'qa_review' | 'pr_created' | 'completed' | 'failed';
  specId?: string;
  prId?: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface AzureDevOpsWorkItemBatch {
  id: string;
  workItems: Array<{ id: number; title: string; similarity: number }>;
  commonThemes: string[];
  confidence: number;
  reasoning: string;
}

export interface AzureDevOpsBatchProgress {
  phase: 'analyzing' | 'grouping' | 'complete';
  progress: number;
  message: string;
  workItemsAnalyzed?: number;
  totalWorkItems?: number;
}

export interface AzureDevOpsAutoFixProgress {
  phase: 'checking' | 'fetching' | 'analyzing' | 'batching' | 'creating_spec' | 'building' | 'qa_review' | 'creating_pr' | 'complete';
  workItemId: number;
  progress: number;
  message: string;
}

export interface AzureDevOpsAnalyzePreviewResult {
  success: boolean;
  totalWorkItems: number;
  analyzedWorkItems: number;
  alreadyBatched: number;
  proposedBatches: Array<{
    primaryWorkItem: number;
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

// ============================================
// Triage Types
// ============================================

export type AzureDevOpsTriageCategory = 'bug' | 'feature' | 'documentation' | 'question' | 'duplicate' | 'spam' | 'scope_creep';

export interface AzureDevOpsTriageConfig {
  enabled: boolean;
  duplicateThreshold: number;
  spamThreshold: number;
  scopeCreepThreshold: number;
  enableComments: boolean;
}

export interface AzureDevOpsTriageResult {
  workItemId: number;
  category: AzureDevOpsTriageCategory;
  confidence: number;
  tagsToAdd: string[];
  tagsToRemove: string[];
  duplicateOf?: number;
  spamReason?: string;
  scopeCreepReason?: string;
  priority: 'high' | 'medium' | 'low';
  comment?: string;
  triagedAt: string;
}
