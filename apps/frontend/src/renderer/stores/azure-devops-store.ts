import { create } from 'zustand';
import type {
  AzureDevOpsWorkItem,
  AzureDevOpsSyncStatus,
  AzureDevOpsInvestigationStatus,
  AzureDevOpsInvestigationResult
} from '../../shared/types';

interface AzureDevOpsState {
  // Data
  workItems: AzureDevOpsWorkItem[];
  syncStatus: AzureDevOpsSyncStatus | null;

  // UI State
  isLoading: boolean;
  error: string | null;
  selectedWorkItemId: number | null;
  filterState: 'open' | 'closed' | 'all';

  // Investigation state
  investigationStatus: AzureDevOpsInvestigationStatus;
  lastInvestigationResult: AzureDevOpsInvestigationResult | null;

  // Actions
  setWorkItems: (workItems: AzureDevOpsWorkItem[]) => void;
  addWorkItem: (workItem: AzureDevOpsWorkItem) => void;
  updateWorkItem: (workItemId: number, updates: Partial<AzureDevOpsWorkItem>) => void;
  setSyncStatus: (status: AzureDevOpsSyncStatus | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  selectWorkItem: (workItemId: number | null) => void;
  setFilterState: (state: 'open' | 'closed' | 'all') => void;
  setInvestigationStatus: (status: AzureDevOpsInvestigationStatus) => void;
  setInvestigationResult: (result: AzureDevOpsInvestigationResult | null) => void;
  clearWorkItems: () => void;

  // Selectors
  getSelectedWorkItem: () => AzureDevOpsWorkItem | null;
  getFilteredWorkItems: () => AzureDevOpsWorkItem[];
  getOpenWorkItemsCount: () => number;
}

export const useAzureDevOpsStore = create<AzureDevOpsState>((set, get) => ({
  // Initial state
  workItems: [],
  syncStatus: null,
  isLoading: false,
  error: null,
  selectedWorkItemId: null,
  filterState: 'open',
  investigationStatus: {
    phase: 'idle',
    progress: 0,
    message: ''
  },
  lastInvestigationResult: null,

  // Actions
  setWorkItems: (workItems) => set({ workItems, error: null }),

  addWorkItem: (workItem) => set((state) => ({
    workItems: [workItem, ...state.workItems.filter(w => w.id !== workItem.id)]
  })),

  updateWorkItem: (workItemId, updates) => set((state) => ({
    workItems: state.workItems.map(workItem =>
      workItem.id === workItemId ? { ...workItem, ...updates } : workItem
    )
  })),

  setSyncStatus: (syncStatus) => set({ syncStatus }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  selectWorkItem: (selectedWorkItemId) => set({ selectedWorkItemId }),

  setFilterState: (filterState) => set({ filterState }),

  setInvestigationStatus: (investigationStatus) => set({ investigationStatus }),

  setInvestigationResult: (lastInvestigationResult) => set({ lastInvestigationResult }),

  clearWorkItems: () => set({
    workItems: [],
    syncStatus: null,
    selectedWorkItemId: null,
    error: null,
    investigationStatus: { phase: 'idle', progress: 0, message: '' },
    lastInvestigationResult: null
  }),

  // Selectors
  getSelectedWorkItem: () => {
    const { workItems, selectedWorkItemId } = get();
    return workItems.find(w => w.id === selectedWorkItemId) || null;
  },

  getFilteredWorkItems: () => {
    const { workItems, filterState } = get();
    if (filterState === 'all') return workItems;
    // Map Azure DevOps states to 'open' or 'closed'
    // Closed states: 'Closed', 'Done', 'Removed', 'Resolved'
    const closedStates = ['Closed', 'Done', 'Removed', 'Resolved'];
    return workItems.filter(workItem =>
      filterState === 'open'
        ? !closedStates.includes(workItem.state)
        : closedStates.includes(workItem.state)
    );
  },

  getOpenWorkItemsCount: () => {
    const { workItems } = get();
    const closedStates = ['Closed', 'Done', 'Removed', 'Resolved'];
    return workItems.filter(workItem => !closedStates.includes(workItem.state)).length;
  }
}));

// Action functions for use outside of React components
export async function loadAzureDevOpsWorkItems(
  projectId: string,
  state?: 'open' | 'closed' | 'all'
): Promise<void> {
  const store = useAzureDevOpsStore.getState();
  store.setLoading(true);
  store.setError(null);

  // Sync filterState with the requested state
  if (state) {
    store.setFilterState(state);
  }

  try {
    const result = await window.electronAPI.getAzureDevOpsWorkItems(projectId, state);
    if (result.success && result.data) {
      store.setWorkItems(result.data);
    } else {
      store.setError(result.error || 'Failed to load Azure DevOps work items');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

export async function checkAzureDevOpsConnection(projectId: string): Promise<AzureDevOpsSyncStatus | null> {
  const store = useAzureDevOpsStore.getState();

  try {
    const result = await window.electronAPI.checkAzureDevOpsConnection(projectId);
    if (result.success && result.data) {
      store.setSyncStatus(result.data);
      return result.data;
    } else {
      store.setError(result.error || 'Failed to check Azure DevOps connection');
      return null;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

export function investigateAzureDevOpsWorkItem(
  projectId: string,
  workItemId: number,
  selectedCommentIds?: number[]
): void {
  const store = useAzureDevOpsStore.getState();
  store.setInvestigationStatus({
    phase: 'fetching',
    workItemId,
    progress: 0,
    message: 'Starting investigation...'
  });
  store.setInvestigationResult(null);

  window.electronAPI.investigateAzureDevOpsWorkItem(projectId, workItemId, selectedCommentIds);
}

export async function importAzureDevOpsWorkItems(
  projectId: string,
  workItemIds: number[]
): Promise<boolean> {
  const store = useAzureDevOpsStore.getState();
  store.setLoading(true);

  try {
    const result = await window.electronAPI.importAzureDevOpsWorkItems(projectId, workItemIds);
    if (result.success) {
      return true;
    } else {
      store.setError(result.error || 'Failed to import Azure DevOps work items');
      return false;
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
    return false;
  } finally {
    store.setLoading(false);
  }
}
