import { create } from 'zustand';
import type { AllProfilesUsage } from '../../shared/types';
import { debugError } from '../../shared/utils/debug-logger';
import type {
  ProjectUsageSummary,
  UsageData,
  HistoricalAverageCost,
  HistoricalAverageCostOptions
} from '../../preload/api/modules/usage-cost-api';

interface UsageCostState {
  // Data
  projectSummary: ProjectUsageSummary | null;
  taskDetail: UsageData | null;
  prediction: HistoricalAverageCost | null;
  accountHeadroom: AllProfilesUsage | null;
  /** specId of the task currently selected in the dashboard's task picker (drives loadTaskUsageDetail + live refresh). */
  selectedSpecId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setProjectSummary: (projectSummary: ProjectUsageSummary | null) => void;
  setTaskDetail: (taskDetail: UsageData | null) => void;
  setPrediction: (prediction: HistoricalAverageCost | null) => void;
  setAccountHeadroom: (accountHeadroom: AllProfilesUsage | null) => void;
  setSelectedSpecId: (specId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useUsageCostStore = create<UsageCostState>((set, _get) => ({
  // Initial state
  projectSummary: null,
  taskDetail: null,
  prediction: null,
  accountHeadroom: null,
  selectedSpecId: null,
  isLoading: false,
  error: null,

  // Actions
  setProjectSummary: (projectSummary) => set({ projectSummary }),

  setTaskDetail: (taskDetail) => set({ taskDetail }),

  setPrediction: (prediction) => set({ prediction }),

  setAccountHeadroom: (accountHeadroom) => set({ accountHeadroom }),

  setSelectedSpecId: (selectedSpecId) => set({ selectedSpecId }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error })
}));

// Helper functions

export async function loadProjectUsageSummary(projectId: string): Promise<void> {
  const store = useUsageCostStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getProjectUsageSummary(projectId);
    if (result.success && result.data) {
      store.setProjectSummary(result.data.usage);
      store.setAccountHeadroom(result.data.accountHeadroom);
    } else {
      store.setError(result.error || 'Failed to load usage summary');
    }
  } finally {
    store.setLoading(false);
  }
}

export async function loadTaskUsageDetail(projectId: string, specId: string): Promise<void> {
  const store = useUsageCostStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getTaskUsageDetail(projectId, specId);
    if (result.success) {
      store.setTaskDetail(result.data ?? null);
    } else {
      store.setError(result.error || 'Failed to load task usage detail');
    }
  } finally {
    store.setLoading(false);
  }
}

export async function predictCost(
  projectId: string,
  options?: HistoricalAverageCostOptions
): Promise<void> {
  const store = useUsageCostStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.predictTaskCost(projectId, options);
    if (result.success && result.data) {
      store.setPrediction(result.data);
    } else {
      store.setError(result.error || 'Failed to predict cost');
    }
  } finally {
    store.setLoading(false);
  }
}

// IPC listener setup - call this once when the app initializes for live refresh
export function setupUsageCostListeners(projectId: string): () => void {
  const unsubUsageCostUpdated = window.electronAPI.onUsageCostUpdated((specId) => {
    // Refresh the project summary so aggregate totals stay current
    loadProjectUsageSummary(projectId).catch((err) => {
      debugError('Failed to refresh usage summary after update:', err);
    });

    // If the currently selected task (via the dashboard's task picker) matches the
    // updated spec, refresh its detail too so the breakdown table / active-run KPI
    // update in place while that task is running. Compared against `selectedSpecId`
    // (set by the picker) rather than `taskDetail.spec_id`, since taskDetail starts
    // out null on first load and would otherwise never match.
    const { selectedSpecId } = useUsageCostStore.getState();
    if (selectedSpecId && selectedSpecId === specId) {
      loadTaskUsageDetail(projectId, specId).catch((err) => {
        debugError('Failed to refresh task usage detail after update:', err);
      });
    }
  });

  return () => {
    unsubUsageCostUpdated();
  };
}
