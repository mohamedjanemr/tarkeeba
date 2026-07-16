import { useEffect, useCallback, useMemo } from "react";
import {
  useAzureDevOpsStore,
  loadAzureDevOpsWorkItems,
  checkAzureDevOpsConnection,
} from "../../../stores/azure-devops-store";

type FilterState = 'open' | 'closed' | 'all';

export function useAzureDevOpsIssues(projectId: string | undefined) {
  const {
    workItems,
    syncStatus,
    isLoading,
    error,
    selectedWorkItemId,
    filterState,
    selectWorkItem,
    setFilterState,
    getFilteredWorkItems,
    getOpenWorkItemsCount,
  } = useAzureDevOpsStore();

  // Always check connection when component mounts or projectId changes
  useEffect(() => {
    if (projectId) {
      // Always check connection on mount (in case settings changed)
      checkAzureDevOpsConnection(projectId);
    }
  }, [projectId]);

  // Load work items when filter changes or after connection is established
  useEffect(() => {
    if (projectId && syncStatus?.connected) {
      loadAzureDevOpsWorkItems(projectId, filterState);
    }
  }, [projectId, filterState, syncStatus?.connected]);

  const handleRefresh = useCallback(() => {
    if (projectId) {
      // Re-check connection and reload work items
      checkAzureDevOpsConnection(projectId);
      loadAzureDevOpsWorkItems(projectId, filterState);
    }
  }, [projectId, filterState]);

  const handleFilterChange = useCallback(
    (state: FilterState) => {
      setFilterState(state);
      if (projectId) {
        loadAzureDevOpsWorkItems(projectId, state);
      }
    },
    [projectId, setFilterState]
  );

  // Compute selectedWorkItem from workItems array
  const selectedWorkItem = useMemo(() => {
    return workItems.find((w) => w.id === selectedWorkItemId) || null;
  }, [workItems, selectedWorkItemId]);

  return {
    workItems,
    syncStatus,
    isLoading,
    error,
    selectedWorkItemId,
    selectedWorkItem,
    filterState,
    selectWorkItem,
    getFilteredWorkItems,
    getOpenWorkItemsCount,
    handleRefresh,
    handleFilterChange,
  };
}
