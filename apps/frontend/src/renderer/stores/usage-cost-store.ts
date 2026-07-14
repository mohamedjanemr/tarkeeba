import { create } from 'zustand';
import type { AllProfilesUsage } from '../../shared/types';
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
  isLoading: boolean;
  error: string | null;

  // Actions
  setProjectSummary: (projectSummary: ProjectUsageSummary | null) => void;
  setTaskDetail: (taskDetail: UsageData | null) => void;
  setPrediction: (prediction: HistoricalAverageCost | null) => void;
  setAccountHeadroom: (accountHeadroom: AllProfilesUsage | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useUsageCostStore = create<UsageCostState>((set, _get) => ({
  // Initial state
  projectSummary: null,
  taskDetail: null,
  prediction: null,
  accountHeadroom: null,
  isLoading: false,
  error: null,

  // Actions
  setProjectSummary: (projectSummary) => set({ projectSummary }),

  setTaskDetail: (taskDetail) => set({ taskDetail }),

  setPrediction: (prediction) => set({ prediction }),

  setAccountHeadroom: (accountHeadroom) => set({ accountHeadroom }),

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
      console.error('Failed to refresh usage summary after update:', err);
    });

    // If the currently viewed task detail matches the updated spec, refresh it too
    const currentTaskDetail = useUsageCostStore.getState().taskDetail;
    if (currentTaskDetail?.spec_id === specId) {
      loadTaskUsageDetail(projectId, specId).catch((err) => {
        console.error('Failed to refresh task usage detail after update:', err);
      });
    }
  });

  return () => {
    unsubUsageCostUpdated();
  };
}
