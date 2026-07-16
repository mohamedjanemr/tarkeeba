/**
 * Unit tests for Azure DevOps Pull Request handlers
 * Tests PR transformation and state validation
 */
import { describe, it, expect } from 'vitest';

// Test types matching the handler's internal types
interface AzureDevOpsAPIPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: 'abandoned' | 'active' | 'completed';
  sourceRefName: string;
  targetRefName: string;
  createdBy: { displayName: string; uniqueName: string; imageUrl?: string };
  reviewers: Array<{ displayName: string; uniqueName: string; imageUrl?: string; vote: number }>;
  labels?: Array<{ id: string; name: string }>;
  url: string;
  creationDate: string;
  closedDate?: string;
}

interface AzureDevOpsPullRequest {
  id: number;
  title: string;
  description?: string;
  status: string;
  sourceBranch: string;
  targetBranch: string;
  author: { displayName: string; imageUrl?: string };
  reviewers: Array<{ displayName: string; imageUrl?: string; vote: number }>;
  labels: string[];
  webUrl: string;
  createdAt: string;
  closedAt?: string;
  projectName: string;
}

/**
 * Extract branch name from ref name (e.g., "refs/heads/feature" -> "feature")
 */
function extractBranchName(refName: string): string {
  const match = refName.match(/refs\/heads\/(.+)$/);
  return match ? match[1] : refName;
}

/**
 * Transform Azure DevOps API PR to our format
 */
function transformPullRequest(apiPr: AzureDevOpsAPIPullRequest, projectName: string, webUrl: string): AzureDevOpsPullRequest {
  return {
    id: apiPr.pullRequestId,
    title: apiPr.title,
    description: apiPr.description,
    status: apiPr.status,
    sourceBranch: extractBranchName(apiPr.sourceRefName),
    targetBranch: extractBranchName(apiPr.targetRefName),
    author: {
      displayName: apiPr.createdBy.displayName,
      imageUrl: apiPr.createdBy.imageUrl
    },
    reviewers: apiPr.reviewers.map(r => ({
      displayName: r.displayName,
      imageUrl: r.imageUrl,
      vote: r.vote
    })),
    labels: apiPr.labels?.map(l => l.name) ?? [],
    webUrl,
    createdAt: apiPr.creationDate,
    closedAt: apiPr.closedDate,
    projectName
  };
}

/**
 * Validate PR status is one of the known statuses
 */
function isValidPRStatus(status: string): status is 'abandoned' | 'active' | 'completed' {
  return ['abandoned', 'active', 'completed'].includes(status);
}

describe('Azure DevOps Pull Request Handlers', () => {
  describe('extractBranchName', () => {
    it('should extract branch name from refs/heads format', () => {
      expect(extractBranchName('refs/heads/feature')).toBe('feature');
      expect(extractBranchName('refs/heads/bugfix/issue-123')).toBe('bugfix/issue-123');
      expect(extractBranchName('refs/heads/release/v1.0.0')).toBe('release/v1.0.0');
    });

    it('should handle main/master branches', () => {
      expect(extractBranchName('refs/heads/main')).toBe('main');
      expect(extractBranchName('refs/heads/master')).toBe('master');
      expect(extractBranchName('refs/heads/develop')).toBe('develop');
    });

    it('should return original string if not in refs/heads format', () => {
      expect(extractBranchName('main')).toBe('main');
      expect(extractBranchName('feature')).toBe('feature');
      expect(extractBranchName('refs/tags/v1.0.0')).toBe('refs/tags/v1.0.0');
    });

    it('should handle complex branch names', () => {
      expect(extractBranchName('refs/heads/feature/PROJ-123-description')).toBe('feature/PROJ-123-description');
      expect(extractBranchName('refs/heads/user/john/feature')).toBe('user/john/feature');
      expect(extractBranchName('refs/heads/feature-with-dashes')).toBe('feature-with-dashes');
    });
  });

  describe('transformPullRequest', () => {
    const baseApiPr: AzureDevOpsAPIPullRequest = {
      pullRequestId: 42,
      title: 'Add new feature',
      description: 'This PR adds an awesome feature',
      status: 'active',
      sourceRefName: 'refs/heads/feature/awesome',
      targetRefName: 'refs/heads/main',
      createdBy: { displayName: 'Developer', uniqueName: 'dev@example.com', imageUrl: 'https://dev.azure.com/dev-avatar.png' },
      reviewers: [
        { displayName: 'Reviewer 1', uniqueName: 'reviewer1@example.com', imageUrl: 'https://dev.azure.com/rev1-avatar.png', vote: 0 },
        { displayName: 'Reviewer 2', uniqueName: 'reviewer2@example.com', imageUrl: 'https://dev.azure.com/rev2-avatar.png', vote: 1 }
      ],
      labels: [{ id: 'label-1', name: 'enhancement' }, { id: 'label-2', name: 'ready-to-merge' }],
      url: 'https://dev.azure.com/_apis/git/repositories/repo-id/pullrequests/42',
      creationDate: '2024-01-15T10:00:00Z'
    };

    const projectName = 'TestProject';
    const webUrl = 'https://dev.azure.com/project/_git/repo/pullrequest/42';

    it('should transform basic PR correctly', () => {
      const result = transformPullRequest(baseApiPr, projectName, webUrl);

      expect(result.id).toBe(42);
      expect(result.title).toBe('Add new feature');
      expect(result.description).toBe('This PR adds an awesome feature');
      expect(result.status).toBe('active');
      expect(result.projectName).toBe('TestProject');
    });

    it('should extract branch names correctly', () => {
      const result = transformPullRequest(baseApiPr, projectName, webUrl);

      expect(result.sourceBranch).toBe('feature/awesome');
      expect(result.targetBranch).toBe('main');
    });

    it('should transform author correctly', () => {
      const result = transformPullRequest(baseApiPr, projectName, webUrl);

      expect(result.author.displayName).toBe('Developer');
      expect(result.author.imageUrl).toBe('https://dev.azure.com/dev-avatar.png');
    });

    it('should transform reviewers correctly', () => {
      const result = transformPullRequest(baseApiPr, projectName, webUrl);

      expect(result.reviewers).toHaveLength(2);
      expect(result.reviewers[0].displayName).toBe('Reviewer 1');
      expect(result.reviewers[0].vote).toBe(0);
      expect(result.reviewers[1].displayName).toBe('Reviewer 2');
      expect(result.reviewers[1].vote).toBe(1);
    });

    it('should transform labels correctly', () => {
      const result = transformPullRequest(baseApiPr, projectName, webUrl);

      expect(result.labels).toEqual(['enhancement', 'ready-to-merge']);
    });

    it('should handle PR with no labels', () => {
      const noLabelspr: AzureDevOpsAPIPullRequest = {
        ...baseApiPr,
        labels: undefined
      };

      const result = transformPullRequest(noLabelspr, projectName, webUrl);

      expect(result.labels).toEqual([]);
    });

    it('should transform timestamps correctly', () => {
      const result = transformPullRequest(baseApiPr, projectName, webUrl);

      expect(result.createdAt).toBe('2024-01-15T10:00:00Z');
      expect(result.closedAt).toBeUndefined();
    });

    it('should handle closed/completed PRs', () => {
      const completedPr: AzureDevOpsAPIPullRequest = {
        ...baseApiPr,
        status: 'completed',
        closedDate: '2024-01-20T15:00:00Z'
      };

      const result = transformPullRequest(completedPr, projectName, webUrl);

      expect(result.status).toBe('completed');
      expect(result.closedAt).toBe('2024-01-20T15:00:00Z');
    });

    it('should handle abandoned PRs', () => {
      const abandonedPr: AzureDevOpsAPIPullRequest = {
        ...baseApiPr,
        status: 'abandoned',
        closedDate: '2024-01-17T10:00:00Z'
      };

      const result = transformPullRequest(abandonedPr, projectName, webUrl);

      expect(result.status).toBe('abandoned');
      expect(result.closedAt).toBe('2024-01-17T10:00:00Z');
    });

    it('should handle author without image URL', () => {
      const noImagePr: AzureDevOpsAPIPullRequest = {
        ...baseApiPr,
        createdBy: { displayName: 'Developer', uniqueName: 'dev@example.com' }
      };

      const result = transformPullRequest(noImagePr, projectName, webUrl);

      expect(result.author.displayName).toBe('Developer');
      expect(result.author.imageUrl).toBeUndefined();
    });

    it('should handle reviewers without image URLs', () => {
      const noImagePr: AzureDevOpsAPIPullRequest = {
        ...baseApiPr,
        reviewers: [
          { displayName: 'Reviewer', uniqueName: 'reviewer@example.com', vote: 1 }
        ]
      };

      const result = transformPullRequest(noImagePr, projectName, webUrl);

      expect(result.reviewers[0].displayName).toBe('Reviewer');
      expect(result.reviewers[0].imageUrl).toBeUndefined();
    });

    it('should handle minimal PR', () => {
      const minimalPr: AzureDevOpsAPIPullRequest = {
        pullRequestId: 1,
        title: 'Fix',
        status: 'active',
        sourceRefName: 'refs/heads/fix',
        targetRefName: 'refs/heads/main',
        createdBy: { displayName: 'User', uniqueName: 'user@example.com' },
        reviewers: [],
        url: 'https://dev.azure.com/_apis/git/repositories/repo-id/pullrequests/1',
        creationDate: '2024-01-15T10:00:00Z'
      };

      const result = transformPullRequest(minimalPr, projectName, webUrl);

      expect(result.id).toBe(1);
      expect(result.title).toBe('Fix');
      expect(result.description).toBeUndefined();
      expect(result.reviewers).toEqual([]);
      expect(result.labels).toEqual([]);
    });
  });

  describe('isValidPRStatus', () => {
    it('should accept valid PR statuses', () => {
      expect(isValidPRStatus('active')).toBe(true);
      expect(isValidPRStatus('completed')).toBe(true);
      expect(isValidPRStatus('abandoned')).toBe(true);
    });

    it('should reject invalid PR statuses', () => {
      expect(isValidPRStatus('open')).toBe(false);
      expect(isValidPRStatus('merged')).toBe(false);
      expect(isValidPRStatus('draft')).toBe(false);
      expect(isValidPRStatus('Active')).toBe(false); // Case sensitive
      expect(isValidPRStatus('')).toBe(false);
    });

    it('should type narrow correctly', () => {
      const statuses: string[] = ['active', 'completed', 'abandoned', 'invalid'];
      const validStatuses = statuses.filter(s => isValidPRStatus(s)) as Array<'active' | 'completed' | 'abandoned'>;

      expect(validStatuses).toHaveLength(3);
      expect(validStatuses[0]).toBe('active');
    });
  });

  describe('Pull request list transformations', () => {
    it('should transform multiple PRs', () => {
      const prs: AzureDevOpsAPIPullRequest[] = [
        {
          pullRequestId: 1,
          title: 'PR 1',
          status: 'active',
          sourceRefName: 'refs/heads/feature1',
          targetRefName: 'refs/heads/main',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          reviewers: [],
          url: 'https://dev.azure.com/_apis/git/repositories/repo-id/pullrequests/1',
          creationDate: '2024-01-15T10:00:00Z'
        },
        {
          pullRequestId: 2,
          title: 'PR 2',
          status: 'completed',
          sourceRefName: 'refs/heads/feature2',
          targetRefName: 'refs/heads/main',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          reviewers: [],
          url: 'https://dev.azure.com/_apis/git/repositories/repo-id/pullrequests/2',
          creationDate: '2024-01-15T10:00:00Z',
          closedDate: '2024-01-20T15:00:00Z'
        }
      ];

      const transformed = prs.map(pr => transformPullRequest(pr, 'TestProject', `https://dev.azure.com/project/_git/repo/pullrequest/${pr.pullRequestId}`));

      expect(transformed).toHaveLength(2);
      expect(transformed[0].status).toBe('active');
      expect(transformed[1].status).toBe('completed');
    });

    it('should handle empty PR list', () => {
      const prs: AzureDevOpsAPIPullRequest[] = [];
      const transformed = prs.map(pr => transformPullRequest(pr, 'TestProject', 'https://dev.azure.com'));

      expect(transformed).toHaveLength(0);
      expect(transformed).toEqual([]);
    });

    it('should preserve PR order', () => {
      const prs: AzureDevOpsAPIPullRequest[] = [
        {
          pullRequestId: 30,
          title: 'PR 3',
          status: 'active',
          sourceRefName: 'refs/heads/feature3',
          targetRefName: 'refs/heads/main',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          reviewers: [],
          url: 'https://dev.azure.com/_apis/git/repositories/repo-id/pullrequests/30',
          creationDate: '2024-01-15T10:00:00Z'
        },
        {
          pullRequestId: 10,
          title: 'PR 1',
          status: 'active',
          sourceRefName: 'refs/heads/feature1',
          targetRefName: 'refs/heads/main',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          reviewers: [],
          url: 'https://dev.azure.com/_apis/git/repositories/repo-id/pullrequests/10',
          creationDate: '2024-01-15T10:00:00Z'
        }
      ];

      const transformed = prs.map(pr => transformPullRequest(pr, 'TestProject', `https://dev.azure.com/project/_git/repo/pullrequest/${pr.pullRequestId}`));

      expect(transformed[0].id).toBe(30);
      expect(transformed[1].id).toBe(10);
    });
  });
});
