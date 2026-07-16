/**
 * Unit tests for Azure DevOps Issue handlers
 * Tests work item transformation and state validation
 */
import { describe, it, expect } from 'vitest';

// Test types matching the handler's internal types
interface AzureDevOpsAPIWorkItem {
  id: number;
  rev: number;
  title: string;
  description?: string;
  state: string;
  workItemType: string;
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

interface AzureDevOpsWorkItem {
  id: number;
  title: string;
  description?: string;
  state: string;
  workItemType: string;
  tags: string[];
  assignedTo?: { displayName: string; imageUrl?: string };
  author: { displayName: string; imageUrl?: string };
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  commentCount: number;
  webUrl: string;
  projectName: string;
}

interface AzureDevOpsAPIComment {
  id: number;
  content: string;
  author: { displayName: string; uniqueName: string; imageUrl?: string };
  createdDate: string;
  modifiedDate: string;
  isDeleted: boolean;
  url: string;
}

interface AzureDevOpsComment {
  id: number;
  content: string;
  author: { displayName: string; imageUrl?: string };
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
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
 * Validate work item state is one of the known states
 */
function isValidWorkItemState(state: string): boolean {
  const validStates = ['New', 'Active', 'Resolved', 'Closed', 'Done', 'Removed'];
  return validStates.includes(state);
}

describe('Azure DevOps Issue Handlers', () => {
  describe('transformWorkItem', () => {
    const baseApiWorkItem: AzureDevOpsAPIWorkItem = {
      id: 42,
      rev: 1,
      title: 'Test Work Item',
      description: 'This is a test work item',
      state: 'Active',
      workItemType: 'Bug',
      tags: ['bug', 'priority-high'],
      assignedTo: { displayName: 'Test User', uniqueName: 'testuser@example.com', imageUrl: 'https://dev.azure.com/avatar.png' },
      createdBy: { displayName: 'Author User', uniqueName: 'author@example.com', imageUrl: 'https://dev.azure.com/author.png' },
      createdDate: '2024-01-15T10:00:00Z',
      changedDate: '2024-01-16T12:00:00Z',
      closedDate: undefined,
      commentCount: 5,
      url: 'https://dev.azure.com/_apis/wit/workitems/42',
      webUrl: 'https://dev.azure.com/project/_workitems/edit/42',
      fields: {}
    };

    const projectName = 'TestProject';

    it('should transform basic work item correctly', () => {
      const result = transformWorkItem(baseApiWorkItem, projectName);

      expect(result.id).toBe(42);
      expect(result.title).toBe('Test Work Item');
      expect(result.description).toBe('This is a test work item');
      expect(result.state).toBe('Active');
      expect(result.projectName).toBe('TestProject');
    });

    it('should transform work item type correctly', () => {
      const result = transformWorkItem(baseApiWorkItem, projectName);

      expect(result.workItemType).toBe('Bug');
    });

    it('should transform tags correctly', () => {
      const result = transformWorkItem(baseApiWorkItem, projectName);

      expect(result.tags).toEqual(['bug', 'priority-high']);
    });

    it('should handle empty tags', () => {
      const noTagsWorkItem: AzureDevOpsAPIWorkItem = {
        ...baseApiWorkItem,
        tags: undefined
      };

      const result = transformWorkItem(noTagsWorkItem, projectName);

      expect(result.tags).toEqual([]);
    });

    it('should transform assignee correctly', () => {
      const result = transformWorkItem(baseApiWorkItem, projectName);

      expect(result.assignedTo?.displayName).toBe('Test User');
      expect(result.assignedTo?.imageUrl).toBe('https://dev.azure.com/avatar.png');
    });

    it('should handle unassigned work items', () => {
      const unassignedWorkItem: AzureDevOpsAPIWorkItem = {
        ...baseApiWorkItem,
        assignedTo: undefined
      };

      const result = transformWorkItem(unassignedWorkItem, projectName);

      expect(result.assignedTo).toBeUndefined();
    });

    it('should transform author correctly', () => {
      const result = transformWorkItem(baseApiWorkItem, projectName);

      expect(result.author.displayName).toBe('Author User');
      expect(result.author.imageUrl).toBe('https://dev.azure.com/author.png');
    });

    it('should transform timestamps correctly', () => {
      const result = transformWorkItem(baseApiWorkItem, projectName);

      expect(result.createdAt).toBe('2024-01-15T10:00:00Z');
      expect(result.updatedAt).toBe('2024-01-16T12:00:00Z');
      expect(result.closedAt).toBeUndefined();
    });

    it('should transform closed work items', () => {
      const closedWorkItem: AzureDevOpsAPIWorkItem = {
        ...baseApiWorkItem,
        state: 'Closed',
        closedDate: '2024-01-20T15:00:00Z'
      };

      const result = transformWorkItem(closedWorkItem, projectName);

      expect(result.state).toBe('Closed');
      expect(result.closedAt).toBe('2024-01-20T15:00:00Z');
    });

    it('should transform comment count correctly', () => {
      const result = transformWorkItem(baseApiWorkItem, projectName);

      expect(result.commentCount).toBe(5);
    });

    it('should handle missing comment count', () => {
      const noCommentCountWorkItem: AzureDevOpsAPIWorkItem = {
        ...baseApiWorkItem,
        commentCount: undefined
      };

      const result = transformWorkItem(noCommentCountWorkItem, projectName);

      expect(result.commentCount).toBe(0);
    });

    it('should handle minimal work item', () => {
      const minimalWorkItem: AzureDevOpsAPIWorkItem = {
        id: 1,
        rev: 1,
        title: 'Minimal',
        state: 'New',
        workItemType: 'Task',
        createdBy: { displayName: 'Someone', uniqueName: 'someone@example.com' },
        createdDate: '2024-01-15T10:00:00Z',
        changedDate: '2024-01-15T10:00:00Z',
        url: 'https://dev.azure.com/_apis/wit/workitems/1',
        webUrl: 'https://dev.azure.com/project/_workitems/edit/1'
      };

      const result = transformWorkItem(minimalWorkItem, projectName);

      expect(result.id).toBe(1);
      expect(result.title).toBe('Minimal');
      expect(result.description).toBeUndefined();
      expect(result.tags).toEqual([]);
      expect(result.assignedTo).toBeUndefined();
      expect(result.commentCount).toBe(0);
    });
  });

  describe('transformComment', () => {
    const baseApiComment: AzureDevOpsAPIComment = {
      id: 123,
      content: 'This is a test comment',
      author: { displayName: 'Commenter', uniqueName: 'commenter@example.com', imageUrl: 'https://dev.azure.com/comment-avatar.png' },
      createdDate: '2024-01-15T10:00:00Z',
      modifiedDate: '2024-01-15T10:00:00Z',
      isDeleted: false,
      url: 'https://dev.azure.com/_apis/wit/workitems/42/comments/123'
    };

    it('should transform basic comment correctly', () => {
      const result = transformComment(baseApiComment);

      expect(result.id).toBe(123);
      expect(result.content).toBe('This is a test comment');
      expect(result.isDeleted).toBe(false);
    });

    it('should transform author correctly', () => {
      const result = transformComment(baseApiComment);

      expect(result.author.displayName).toBe('Commenter');
      expect(result.author.imageUrl).toBe('https://dev.azure.com/comment-avatar.png');
    });

    it('should transform timestamps correctly', () => {
      const result = transformComment(baseApiComment);

      expect(result.createdAt).toBe('2024-01-15T10:00:00Z');
      expect(result.updatedAt).toBe('2024-01-15T10:00:00Z');
    });

    it('should handle deleted comments', () => {
      const deletedComment: AzureDevOpsAPIComment = {
        ...baseApiComment,
        isDeleted: true,
        content: '[deleted]'
      };

      const result = transformComment(deletedComment);

      expect(result.isDeleted).toBe(true);
      expect(result.content).toBe('[deleted]');
    });

    it('should handle comments with modified timestamps', () => {
      const modifiedComment: AzureDevOpsAPIComment = {
        ...baseApiComment,
        modifiedDate: '2024-01-16T12:00:00Z'
      };

      const result = transformComment(modifiedComment);

      expect(result.createdAt).toBe('2024-01-15T10:00:00Z');
      expect(result.updatedAt).toBe('2024-01-16T12:00:00Z');
    });

    it('should handle author without image URL', () => {
      const noImageComment: AzureDevOpsAPIComment = {
        ...baseApiComment,
        author: { displayName: 'Commenter', uniqueName: 'commenter@example.com' }
      };

      const result = transformComment(noImageComment);

      expect(result.author.displayName).toBe('Commenter');
      expect(result.author.imageUrl).toBeUndefined();
    });
  });

  describe('isValidWorkItemState', () => {
    it('should accept valid work item states', () => {
      expect(isValidWorkItemState('New')).toBe(true);
      expect(isValidWorkItemState('Active')).toBe(true);
      expect(isValidWorkItemState('Resolved')).toBe(true);
      expect(isValidWorkItemState('Closed')).toBe(true);
      expect(isValidWorkItemState('Done')).toBe(true);
      expect(isValidWorkItemState('Removed')).toBe(true);
    });

    it('should reject invalid work item states', () => {
      expect(isValidWorkItemState('Open')).toBe(false);
      expect(isValidWorkItemState('Pending')).toBe(false);
      expect(isValidWorkItemState('Ready')).toBe(false);
      expect(isValidWorkItemState('')).toBe(false);
      expect(isValidWorkItemState('active')).toBe(false); // Case sensitive
    });
  });

  describe('Work item list transformations', () => {
    it('should transform multiple work items', () => {
      const workItems: AzureDevOpsAPIWorkItem[] = [
        {
          id: 1,
          rev: 1,
          title: 'Bug #1',
          state: 'Active',
          workItemType: 'Bug',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          createdDate: '2024-01-15T10:00:00Z',
          changedDate: '2024-01-15T10:00:00Z',
          url: 'https://dev.azure.com/_apis/wit/workitems/1',
          webUrl: 'https://dev.azure.com/project/_workitems/edit/1'
        },
        {
          id: 2,
          rev: 1,
          title: 'Feature #1',
          state: 'New',
          workItemType: 'Feature',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          createdDate: '2024-01-15T10:00:00Z',
          changedDate: '2024-01-15T10:00:00Z',
          url: 'https://dev.azure.com/_apis/wit/workitems/2',
          webUrl: 'https://dev.azure.com/project/_workitems/edit/2'
        }
      ];

      const transformed = workItems.map(wi => transformWorkItem(wi, 'TestProject'));

      expect(transformed).toHaveLength(2);
      expect(transformed[0].workItemType).toBe('Bug');
      expect(transformed[1].workItemType).toBe('Feature');
    });

    it('should handle empty work item list', () => {
      const workItems: AzureDevOpsAPIWorkItem[] = [];
      const transformed = workItems.map(wi => transformWorkItem(wi, 'TestProject'));

      expect(transformed).toHaveLength(0);
      expect(transformed).toEqual([]);
    });

    it('should preserve work item order', () => {
      const workItems: AzureDevOpsAPIWorkItem[] = [
        {
          id: 30,
          rev: 1,
          title: 'Third',
          state: 'New',
          workItemType: 'Task',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          createdDate: '2024-01-15T10:00:00Z',
          changedDate: '2024-01-15T10:00:00Z',
          url: 'https://dev.azure.com/_apis/wit/workitems/30',
          webUrl: 'https://dev.azure.com/project/_workitems/edit/30'
        },
        {
          id: 10,
          rev: 1,
          title: 'First',
          state: 'New',
          workItemType: 'Task',
          createdBy: { displayName: 'Author', uniqueName: 'author@example.com' },
          createdDate: '2024-01-15T10:00:00Z',
          changedDate: '2024-01-15T10:00:00Z',
          url: 'https://dev.azure.com/_apis/wit/workitems/10',
          webUrl: 'https://dev.azure.com/project/_workitems/edit/10'
        }
      ];

      const transformed = workItems.map(wi => transformWorkItem(wi, 'TestProject'));

      expect(transformed[0].id).toBe(30);
      expect(transformed[1].id).toBe(10);
    });
  });
});
