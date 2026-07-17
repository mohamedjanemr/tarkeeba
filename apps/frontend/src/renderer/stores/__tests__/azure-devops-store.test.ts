/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for azure-devops-store
 * Tests that cover connect/disconnect, set-config, load-items state transitions,
 * selectors, and async action functions for Azure DevOps integration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AzureDevOpsWorkItem,
  AzureDevOpsSyncStatus,
  AzureDevOpsInvestigationStatus,
  AzureDevOpsInvestigationResult
} from '../../../shared/types';

// Mock the electronAPI for IPC communication
const mockGetAzureDevOpsWorkItems = vi.fn();
const mockCheckAzureDevOpsConnection = vi.fn();
const mockInvestigateAzureDevOpsWorkItem = vi.fn();
const mockImportAzureDevOpsWorkItems = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    getAzureDevOpsWorkItems: mockGetAzureDevOpsWorkItems,
    checkAzureDevOpsConnection: mockCheckAzureDevOpsConnection,
    investigateAzureDevOpsWorkItem: mockInvestigateAzureDevOpsWorkItem,
    importAzureDevOpsWorkItems: mockImportAzureDevOpsWorkItems
  }
});

const sampleWorkItem: AzureDevOpsWorkItem = {
  id: 1,
  title: 'Test Work Item',
  workItemType: 'User Story',
  state: 'Active',
  description: 'This is a test work item',
  tags: [],
  assignedTo: { displayName: 'Test User' },
  author: { displayName: 'Test Author' },
  createdAt: '2026-07-15T09:00:00Z',
  updatedAt: '2026-07-15T10:00:00Z',
  commentCount: 0,
  webUrl: 'https://example.com/work/1',
  projectName: 'Test Project'
};

const sampleClosedWorkItem: AzureDevOpsWorkItem = {
  id: 2,
  title: 'Closed Work Item',
  workItemType: 'Bug',
  state: 'Closed',
  description: 'This is a closed work item',
  tags: [],
  assignedTo: { displayName: 'Test User' },
  author: { displayName: 'Test Author' },
  createdAt: '2026-07-14T09:00:00Z',
  updatedAt: '2026-07-15T10:00:00Z',
  closedAt: '2026-07-15T10:00:00Z',
  commentCount: 0,
  webUrl: 'https://example.com/work/2',
  projectName: 'Test Project'
};

const sampleSyncStatus: AzureDevOpsSyncStatus = {
  connected: true,
  lastSyncedAt: '2026-07-15T10:00:00Z',
  workItemCount: 42,
  organizationName: 'MyOrg',
  projectName: 'Test Project'
};

const sampleInvestigationResult: AzureDevOpsInvestigationResult = {
  success: true,
  workItemId: 1,
  analysis: {
    summary: 'Investigation findings here',
    proposedSolution: 'Apply the suggested fix',
    affectedFiles: ['src/example.ts'],
    estimatedComplexity: 'simple',
    acceptanceCriteria: ['The issue is resolved']
  }
};

describe('azure-devops-store', () => {
  let useAzureDevOpsStore: typeof import('../azure-devops-store').useAzureDevOpsStore;
  let loadAzureDevOpsWorkItems: typeof import('../azure-devops-store').loadAzureDevOpsWorkItems;
  let checkAzureDevOpsConnection: typeof import('../azure-devops-store').checkAzureDevOpsConnection;
  let investigateAzureDevOpsWorkItem: typeof import('../azure-devops-store').investigateAzureDevOpsWorkItem;
  let importAzureDevOpsWorkItems: typeof import('../azure-devops-store').importAzureDevOpsWorkItems;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const storeModule = await import('../azure-devops-store');
    useAzureDevOpsStore = storeModule.useAzureDevOpsStore;
    loadAzureDevOpsWorkItems = storeModule.loadAzureDevOpsWorkItems;
    checkAzureDevOpsConnection = storeModule.checkAzureDevOpsConnection;
    investigateAzureDevOpsWorkItem = storeModule.investigateAzureDevOpsWorkItem;
    importAzureDevOpsWorkItems = storeModule.importAzureDevOpsWorkItems;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Store initialization', () => {
    it('should initialize with default state', () => {
      const state = useAzureDevOpsStore.getState();

      expect(state.workItems).toEqual([]);
      expect(state.syncStatus).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.selectedWorkItemId).toBeNull();
      expect(state.filterState).toBe('open');
      expect(state.investigationStatus).toEqual({
        phase: 'idle',
        progress: 0,
        message: ''
      });
      expect(state.lastInvestigationResult).toBeNull();
    });
  });

  describe('Store setters - connect/disconnect transitions', () => {
    it('should set sync status (connect)', () => {
      const store = useAzureDevOpsStore.getState();
      store.setSyncStatus(sampleSyncStatus);

      expect(useAzureDevOpsStore.getState().syncStatus).toEqual(sampleSyncStatus);
    });

    it('should clear sync status (disconnect)', () => {
      const store = useAzureDevOpsStore.getState();
      store.setSyncStatus(sampleSyncStatus);
      expect(useAzureDevOpsStore.getState().syncStatus).toEqual(sampleSyncStatus);

      store.setSyncStatus(null);
      expect(useAzureDevOpsStore.getState().syncStatus).toBeNull();
    });

    it('should set loading state', () => {
      const store = useAzureDevOpsStore.getState();
      store.setLoading(true);
      expect(useAzureDevOpsStore.getState().isLoading).toBe(true);

      store.setLoading(false);
      expect(useAzureDevOpsStore.getState().isLoading).toBe(false);
    });

    it('should set error state', () => {
      const store = useAzureDevOpsStore.getState();
      store.setError('Connection failed');
      expect(useAzureDevOpsStore.getState().error).toBe('Connection failed');
      expect(useAzureDevOpsStore.getState().isLoading).toBe(false);

      store.setError(null);
      expect(useAzureDevOpsStore.getState().error).toBeNull();
    });
  });

  describe('Store setters - config/filter transitions', () => {
    it('should set filter state to open', () => {
      const store = useAzureDevOpsStore.getState();
      store.setFilterState('open');
      expect(useAzureDevOpsStore.getState().filterState).toBe('open');
    });

    it('should set filter state to closed', () => {
      const store = useAzureDevOpsStore.getState();
      store.setFilterState('closed');
      expect(useAzureDevOpsStore.getState().filterState).toBe('closed');
    });

    it('should set filter state to all', () => {
      const store = useAzureDevOpsStore.getState();
      store.setFilterState('all');
      expect(useAzureDevOpsStore.getState().filterState).toBe('all');
    });
  });

  describe('Store setters - load-items transitions', () => {
    it('should set work items and clear error', () => {
      const store = useAzureDevOpsStore.getState();
      store.setError('Previous error');

      store.setWorkItems([sampleWorkItem, sampleClosedWorkItem]);

      const state = useAzureDevOpsStore.getState();
      expect(state.workItems).toEqual([sampleWorkItem, sampleClosedWorkItem]);
      expect(state.error).toBeNull();
    });

    it('should add work item to beginning of list', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleClosedWorkItem]);

      store.addWorkItem(sampleWorkItem);

      const state = useAzureDevOpsStore.getState();
      expect(state.workItems).toHaveLength(2);
      expect(state.workItems[0]).toEqual(sampleWorkItem);
      expect(state.workItems[1]).toEqual(sampleClosedWorkItem);
    });

    it('should replace duplicate work item when adding', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem]);

      const updatedWorkItem: AzureDevOpsWorkItem = {
        ...sampleWorkItem,
        title: 'Updated Title'
      };
      store.addWorkItem(updatedWorkItem);

      const state = useAzureDevOpsStore.getState();
      expect(state.workItems).toHaveLength(1);
      expect(state.workItems[0].title).toBe('Updated Title');
    });

    it('should update work item by id', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem, sampleClosedWorkItem]);

      store.updateWorkItem(1, { title: 'New Title', state: 'Resolved' });

      const state = useAzureDevOpsStore.getState();
      expect(state.workItems[0].title).toBe('New Title');
      expect(state.workItems[0].state).toBe('Resolved');
      expect(state.workItems[1]).toEqual(sampleClosedWorkItem);
    });

    it('should select work item by id', () => {
      const store = useAzureDevOpsStore.getState();
      store.selectWorkItem(1);
      expect(useAzureDevOpsStore.getState().selectedWorkItemId).toBe(1);

      store.selectWorkItem(null);
      expect(useAzureDevOpsStore.getState().selectedWorkItemId).toBeNull();
    });
  });

  describe('Store setters - investigation transitions', () => {
    it('should set investigation status', () => {
      const store = useAzureDevOpsStore.getState();
      const status: AzureDevOpsInvestigationStatus = {
        phase: 'fetching',
        workItemId: 1,
        progress: 50,
        message: 'Investigating...'
      };

      store.setInvestigationStatus(status);

      expect(useAzureDevOpsStore.getState().investigationStatus).toEqual(status);
    });

    it('should set investigation result', () => {
      const store = useAzureDevOpsStore.getState();
      store.setInvestigationResult(sampleInvestigationResult);

      expect(useAzureDevOpsStore.getState().lastInvestigationResult).toEqual(
        sampleInvestigationResult
      );
    });
  });

  describe('Selectors', () => {
    it('should get selected work item', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem, sampleClosedWorkItem]);
      store.selectWorkItem(1);

      const selected = store.getSelectedWorkItem();
      expect(selected).toEqual(sampleWorkItem);
    });

    it('should return null when no work item selected', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem]);
      store.selectWorkItem(null);

      expect(store.getSelectedWorkItem()).toBeNull();
    });

    it('should return null when selected work item does not exist', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem]);
      store.selectWorkItem(999);

      expect(store.getSelectedWorkItem()).toBeNull();
    });

    it('should filter work items by open state', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem, sampleClosedWorkItem]);
      store.setFilterState('open');

      const filtered = store.getFilteredWorkItems();
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual(sampleWorkItem);
    });

    it('should filter work items by closed state', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem, sampleClosedWorkItem]);
      store.setFilterState('closed');

      const filtered = store.getFilteredWorkItems();
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual(sampleClosedWorkItem);
    });

    it('should return all work items when filter is all', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([sampleWorkItem, sampleClosedWorkItem]);
      store.setFilterState('all');

      const filtered = store.getFilteredWorkItems();
      expect(filtered).toHaveLength(2);
    });

    it('should correctly identify closed states', () => {
      const store = useAzureDevOpsStore.getState();
      const workItems: AzureDevOpsWorkItem[] = [
        { ...sampleWorkItem, id: 1, state: 'Active' },
        { ...sampleWorkItem, id: 2, state: 'Closed' },
        { ...sampleWorkItem, id: 3, state: 'Done' },
        { ...sampleWorkItem, id: 4, state: 'Removed' },
        { ...sampleWorkItem, id: 5, state: 'Resolved' },
        { ...sampleWorkItem, id: 6, state: 'New' }
      ];
      store.setWorkItems(workItems);
      store.setFilterState('closed');

      const closed = store.getFilteredWorkItems();
      expect(closed).toHaveLength(4);
      expect(closed.map(w => w.id)).toEqual([2, 3, 4, 5]);
    });

    it('should count open work items', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([
        { ...sampleWorkItem, id: 1, state: 'Active' },
        { ...sampleWorkItem, id: 2, state: 'Closed' },
        { ...sampleWorkItem, id: 3, state: 'New' }
      ]);

      const count = store.getOpenWorkItemsCount();
      expect(count).toBe(2);
    });

    it('should return zero count when all items are closed', () => {
      const store = useAzureDevOpsStore.getState();
      store.setWorkItems([
        { ...sampleWorkItem, id: 1, state: 'Closed' },
        { ...sampleWorkItem, id: 2, state: 'Done' }
      ]);

      expect(store.getOpenWorkItemsCount()).toBe(0);
    });
  });

  describe('clearWorkItems', () => {
    it('should reset all state to initial values', () => {
      const store = useAzureDevOpsStore.getState();

      store.setWorkItems([sampleWorkItem]);
      store.setSyncStatus(sampleSyncStatus);
      store.selectWorkItem(1);
      store.setError('Some error');
      store.setInvestigationStatus({
        phase: 'fetching',
        workItemId: 1,
        progress: 50,
        message: 'Investigating'
      });
      store.setInvestigationResult(sampleInvestigationResult);

      store.clearWorkItems();

      const state = useAzureDevOpsStore.getState();
      expect(state.workItems).toEqual([]);
      expect(state.syncStatus).toBeNull();
      expect(state.selectedWorkItemId).toBeNull();
      expect(state.error).toBeNull();
      expect(state.investigationStatus).toEqual({
        phase: 'idle',
        progress: 0,
        message: ''
      });
      expect(state.lastInvestigationResult).toBeNull();
    });
  });

  describe('loadAzureDevOpsWorkItems', () => {
    it('should load work items with default filter state', async () => {
      mockGetAzureDevOpsWorkItems.mockResolvedValue({
        success: true,
        data: [sampleWorkItem, sampleClosedWorkItem]
      });

      await loadAzureDevOpsWorkItems('test-project');

      const state = useAzureDevOpsStore.getState();
      expect(mockGetAzureDevOpsWorkItems).toHaveBeenCalledWith('test-project', undefined);
      expect(state.workItems).toEqual([sampleWorkItem, sampleClosedWorkItem]);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('should load work items with specified filter state', async () => {
      mockGetAzureDevOpsWorkItems.mockResolvedValue({
        success: true,
        data: [sampleClosedWorkItem]
      });

      await loadAzureDevOpsWorkItems('test-project', 'closed');

      const state = useAzureDevOpsStore.getState();
      expect(mockGetAzureDevOpsWorkItems).toHaveBeenCalledWith('test-project', 'closed');
      expect(state.workItems).toEqual([sampleClosedWorkItem]);
      expect(state.filterState).toBe('closed');
    });

    it('should set error on failure', async () => {
      mockGetAzureDevOpsWorkItems.mockResolvedValue({
        success: false,
        error: 'Failed to fetch work items'
      });

      await loadAzureDevOpsWorkItems('test-project');

      const state = useAzureDevOpsStore.getState();
      expect(state.error).toBe('Failed to fetch work items');
      expect(state.workItems).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it('should use default error message on failure without error text', async () => {
      mockGetAzureDevOpsWorkItems.mockResolvedValue({ success: false });

      await loadAzureDevOpsWorkItems('test-project');

      expect(useAzureDevOpsStore.getState().error).toBe(
        'Failed to load Azure DevOps work items'
      );
    });

    it('should capture thrown errors', async () => {
      mockGetAzureDevOpsWorkItems.mockRejectedValue(new Error('Network error'));

      await loadAzureDevOpsWorkItems('test-project');

      const state = useAzureDevOpsStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('checkAzureDevOpsConnection', () => {
    it('should return sync status on successful connection check', async () => {
      mockCheckAzureDevOpsConnection.mockResolvedValue({
        success: true,
        data: sampleSyncStatus
      });

      const result = await checkAzureDevOpsConnection('test-project');

      expect(mockCheckAzureDevOpsConnection).toHaveBeenCalledWith('test-project');
      expect(result).toEqual(sampleSyncStatus);
      expect(useAzureDevOpsStore.getState().syncStatus).toEqual(sampleSyncStatus);
      expect(useAzureDevOpsStore.getState().error).toBeNull();
    });

    it('should set error and return null on failure', async () => {
      mockCheckAzureDevOpsConnection.mockResolvedValue({
        success: false,
        error: 'Connection refused'
      });

      const result = await checkAzureDevOpsConnection('test-project');

      expect(result).toBeNull();
      expect(useAzureDevOpsStore.getState().error).toBe('Connection refused');
    });

    it('should use default error message on failure without error text', async () => {
      mockCheckAzureDevOpsConnection.mockResolvedValue({ success: false });

      await checkAzureDevOpsConnection('test-project');

      expect(useAzureDevOpsStore.getState().error).toBe(
        'Failed to check Azure DevOps connection'
      );
    });

    it('should capture thrown errors', async () => {
      mockCheckAzureDevOpsConnection.mockRejectedValue(new Error('Request timeout'));

      const result = await checkAzureDevOpsConnection('test-project');

      expect(result).toBeNull();
      expect(useAzureDevOpsStore.getState().error).toBe('Request timeout');
    });
  });

  describe('investigateAzureDevOpsWorkItem', () => {
    it('should set investigation status and call IPC handler', () => {
      const store = useAzureDevOpsStore.getState();

      investigateAzureDevOpsWorkItem('test-project', 1);

      const state = useAzureDevOpsStore.getState();
      expect(state.investigationStatus.phase).toBe('fetching');
      expect(state.investigationStatus.workItemId).toBe(1);
      expect(state.investigationStatus.progress).toBe(0);
      expect(state.investigationStatus.message).toBe('Starting investigation...');
      expect(mockInvestigateAzureDevOpsWorkItem).toHaveBeenCalledWith('test-project', 1, undefined);
    });

    it('should clear previous investigation result', () => {
      const store = useAzureDevOpsStore.getState();
      store.setInvestigationResult(sampleInvestigationResult);

      investigateAzureDevOpsWorkItem('test-project', 2, [1, 2, 3]);

      expect(useAzureDevOpsStore.getState().lastInvestigationResult).toBeNull();
    });

    it('should include selected comment ids in IPC call', () => {
      investigateAzureDevOpsWorkItem('test-project', 1, [1, 2, 3]);

      expect(mockInvestigateAzureDevOpsWorkItem).toHaveBeenCalledWith('test-project', 1, [1, 2, 3]);
    });
  });

  describe('importAzureDevOpsWorkItems', () => {
    it('should import work items successfully', async () => {
      mockImportAzureDevOpsWorkItems.mockResolvedValue({
        success: true
      });

      const result = await importAzureDevOpsWorkItems('test-project', [1, 2, 3]);

      expect(mockImportAzureDevOpsWorkItems).toHaveBeenCalledWith('test-project', [1, 2, 3]);
      expect(result).toBe(true);
      expect(useAzureDevOpsStore.getState().isLoading).toBe(false);
    });

    it('should set error on import failure', async () => {
      mockImportAzureDevOpsWorkItems.mockResolvedValue({
        success: false,
        error: 'Import failed'
      });

      const result = await importAzureDevOpsWorkItems('test-project', [1, 2]);

      expect(result).toBe(false);
      expect(useAzureDevOpsStore.getState().error).toBe('Import failed');
      expect(useAzureDevOpsStore.getState().isLoading).toBe(false);
    });

    it('should use default error message on failure without error text', async () => {
      mockImportAzureDevOpsWorkItems.mockResolvedValue({ success: false });

      const result = await importAzureDevOpsWorkItems('test-project', [1]);

      expect(result).toBe(false);
      expect(useAzureDevOpsStore.getState().error).toBe(
        'Failed to import Azure DevOps work items'
      );
    });

    it('should capture thrown errors', async () => {
      mockImportAzureDevOpsWorkItems.mockRejectedValue(new Error('Upload failed'));

      const result = await importAzureDevOpsWorkItems('test-project', [1, 2]);

      expect(result).toBe(false);
      expect(useAzureDevOpsStore.getState().error).toBe('Upload failed');
      expect(useAzureDevOpsStore.getState().isLoading).toBe(false);
    });

    it('should set loading state during import', async () => {
      let resolveImport: (value: any) => void;
      const importPromise = new Promise((resolve) => {
        resolveImport = resolve;
      });

      mockImportAzureDevOpsWorkItems.mockReturnValue(importPromise);

      const resultPromise = importAzureDevOpsWorkItems('test-project', [1]);

      const loadingState = useAzureDevOpsStore.getState();
      expect(loadingState.isLoading).toBe(true);

      resolveImport!({ success: true });
      await resultPromise;

      const finalState = useAzureDevOpsStore.getState();
      expect(finalState.isLoading).toBe(false);
    });
  });
});
