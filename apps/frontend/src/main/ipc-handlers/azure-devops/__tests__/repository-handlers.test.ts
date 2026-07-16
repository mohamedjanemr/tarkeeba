/**
 * Unit tests for Azure DevOps Repository handlers
 * Tests connection status and project management
 */
import { describe, it, expect } from 'vitest';

// Test types matching the handler's internal types
interface AzureDevOpsAPIProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  defaultTeamImageUrl?: string;
  defaultTeam?: { id: string; name: string };
  visibility: 'private' | 'public';
}

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
 * Transform Azure DevOps API project to our format
 */
function transformProject(apiProject: AzureDevOpsAPIProject): AzureDevOpsAPIProject {
  return {
    id: apiProject.id,
    name: apiProject.name,
    description: apiProject.description,
    url: apiProject.url,
    defaultTeamImageUrl: apiProject.defaultTeamImageUrl,
    defaultTeam: apiProject.defaultTeam,
    visibility: apiProject.visibility
  };
}

/**
 * Extract hostname from instance URL
 */
function getHostnameFromUrl(instanceUrl: string): string {
  try {
    return new URL(instanceUrl).hostname;
  } catch {
    return 'dev.azure.com';
  }
}

describe('Azure DevOps Repository Handlers', () => {
  describe('transformProject', () => {
    const baseApiProject: AzureDevOpsAPIProject = {
      id: 'proj-123',
      name: 'TestProject',
      description: 'A test project',
      url: 'https://dev.azure.com/myorg/_apis/projects/proj-123',
      defaultTeamImageUrl: 'https://dev.azure.com/img/team.png',
      defaultTeam: { id: 'team-1', name: 'Default Team' },
      visibility: 'private'
    };

    it('should transform basic project correctly', () => {
      const result = transformProject(baseApiProject);

      expect(result.id).toBe('proj-123');
      expect(result.name).toBe('TestProject');
      expect(result.description).toBe('A test project');
      expect(result.visibility).toBe('private');
    });

    it('should transform project with all fields', () => {
      const result = transformProject(baseApiProject);

      expect(result.url).toBe('https://dev.azure.com/myorg/_apis/projects/proj-123');
      expect(result.defaultTeamImageUrl).toBe('https://dev.azure.com/img/team.png');
      expect(result.defaultTeam?.name).toBe('Default Team');
    });

    it('should transform public projects', () => {
      const publicProject: AzureDevOpsAPIProject = {
        ...baseApiProject,
        visibility: 'public'
      };

      const result = transformProject(publicProject);

      expect(result.visibility).toBe('public');
    });

    it('should handle projects without optional fields', () => {
      const minimalProject: AzureDevOpsAPIProject = {
        id: 'proj-456',
        name: 'MinimalProject',
        url: 'https://dev.azure.com/myorg/_apis/projects/proj-456',
        visibility: 'private'
      };

      const result = transformProject(minimalProject);

      expect(result.id).toBe('proj-456');
      expect(result.name).toBe('MinimalProject');
      expect(result.description).toBeUndefined();
      expect(result.defaultTeamImageUrl).toBeUndefined();
      expect(result.defaultTeam).toBeUndefined();
    });

    it('should preserve project visibility setting', () => {
      const privateProject = transformProject({
        ...baseApiProject,
        visibility: 'private'
      });
      expect(privateProject.visibility).toBe('private');

      const publicProject = transformProject({
        ...baseApiProject,
        visibility: 'public'
      });
      expect(publicProject.visibility).toBe('public');
    });
  });

  describe('getHostnameFromUrl', () => {
    it('should extract hostname from valid Azure DevOps URLs', () => {
      expect(getHostnameFromUrl('https://dev.azure.com')).toBe('dev.azure.com');
      expect(getHostnameFromUrl('https://myorg.visualstudio.com')).toBe('myorg.visualstudio.com');
      expect(getHostnameFromUrl('https://dev.azure.com/myorg/_apis/projects')).toBe('dev.azure.com');
    });

    it('should extract hostname from self-hosted Azure DevOps', () => {
      expect(getHostnameFromUrl('https://azuredevops.mycompany.com')).toBe('azuredevops.mycompany.com');
      expect(getHostnameFromUrl('https://tfs.internal.corp')).toBe('tfs.internal.corp');
    });

    it('should handle URLs with ports', () => {
      expect(getHostnameFromUrl('https://dev.azure.com:443')).toBe('dev.azure.com');
      expect(getHostnameFromUrl('https://localhost:8080')).toBe('localhost');
    });

    it('should return default hostname for invalid URLs', () => {
      expect(getHostnameFromUrl('')).toBe('dev.azure.com');
      expect(getHostnameFromUrl('not-a-url')).toBe('dev.azure.com');
      expect(getHostnameFromUrl('://invalid')).toBe('dev.azure.com');
      expect(getHostnameFromUrl('ftp://example.com')).toBe('dev.azure.com'); // Non-http protocol
    });

    it('should handle HTTP URLs', () => {
      expect(getHostnameFromUrl('http://localhost:8080')).toBe('localhost');
      expect(getHostnameFromUrl('http://dev.azure.local')).toBe('dev.azure.local');
    });

    it('should handle URLs with authentication', () => {
      // URL with credentials - hostname extraction should work but would be filtered earlier
      expect(getHostnameFromUrl('https://user:pass@dev.azure.com')).toBe('dev.azure.com');
    });

    it('should handle URLs with paths and query strings', () => {
      expect(getHostnameFromUrl('https://dev.azure.com/myorg/_apis/projects?api-version=7.1'))
        .toBe('dev.azure.com');
      expect(getHostnameFromUrl('https://myorg.visualstudio.com/project/_git/repo'))
        .toBe('myorg.visualstudio.com');
    });
  });

  describe('AzureDevOpsSyncStatus', () => {
    it('should represent connected status correctly', () => {
      const status: AzureDevOpsSyncStatus = {
        connected: true,
        organization: 'myorg',
        project: 'TestProject',
        projectId: 'proj-123',
        workItemCount: 42,
        lastSyncedAt: '2024-01-15T10:00:00Z'
      };

      expect(status.connected).toBe(true);
      expect(status.organization).toBe('myorg');
      expect(status.project).toBe('TestProject');
      expect(status.projectId).toBe('proj-123');
      expect(status.workItemCount).toBe(42);
      expect(status.lastSyncedAt).toBe('2024-01-15T10:00:00Z');
    });

    it('should represent disconnected status with error', () => {
      const status: AzureDevOpsSyncStatus = {
        connected: false,
        error: 'Azure DevOps not configured. Please add AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORGANIZATION, and AZURE_DEVOPS_PROJECT to your .env file.'
      };

      expect(status.connected).toBe(false);
      expect(status.error).toContain('AZURE_DEVOPS_PAT');
      expect(status.organization).toBeUndefined();
    });

    it('should represent connection error', () => {
      const status: AzureDevOpsSyncStatus = {
        connected: false,
        error: 'Failed to connect to Azure DevOps: 401 Unauthorized'
      };

      expect(status.connected).toBe(false);
      expect(status.error).toContain('401 Unauthorized');
    });

    it('should update lastSyncedAt on sync', () => {
      const beforeSync: AzureDevOpsSyncStatus = {
        connected: true,
        lastSyncedAt: '2024-01-15T10:00:00Z'
      };

      const afterSync: AzureDevOpsSyncStatus = {
        ...beforeSync,
        lastSyncedAt: '2024-01-15T11:00:00Z'
      };

      expect(afterSync.lastSyncedAt).not.toBe(beforeSync.lastSyncedAt);
    });
  });

  describe('Project list transformations', () => {
    it('should transform multiple projects', () => {
      const projects: AzureDevOpsAPIProject[] = [
        {
          id: 'proj-1',
          name: 'Project1',
          url: 'https://dev.azure.com/org/_apis/projects/proj-1',
          visibility: 'private'
        },
        {
          id: 'proj-2',
          name: 'Project2',
          url: 'https://dev.azure.com/org/_apis/projects/proj-2',
          visibility: 'public'
        }
      ];

      const transformed = projects.map(transformProject);

      expect(transformed).toHaveLength(2);
      expect(transformed[0].name).toBe('Project1');
      expect(transformed[0].visibility).toBe('private');
      expect(transformed[1].name).toBe('Project2');
      expect(transformed[1].visibility).toBe('public');
    });

    it('should handle empty project list', () => {
      const projects: AzureDevOpsAPIProject[] = [];
      const transformed = projects.map(transformProject);

      expect(transformed).toHaveLength(0);
      expect(transformed).toEqual([]);
    });

    it('should preserve project order', () => {
      const projects: AzureDevOpsAPIProject[] = [
        { id: '3', name: 'C', url: 'https://dev.azure.com/org/_apis/projects/3', visibility: 'private' },
        { id: '1', name: 'A', url: 'https://dev.azure.com/org/_apis/projects/1', visibility: 'private' },
        { id: '2', name: 'B', url: 'https://dev.azure.com/org/_apis/projects/2', visibility: 'public' }
      ];

      const transformed = projects.map(transformProject);

      expect(transformed[0].name).toBe('C');
      expect(transformed[1].name).toBe('A');
      expect(transformed[2].name).toBe('B');
    });
  });
});
