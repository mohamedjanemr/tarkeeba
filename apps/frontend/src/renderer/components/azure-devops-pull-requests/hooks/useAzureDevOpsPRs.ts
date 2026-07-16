import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  AzureDevOpsPullRequest,
  AzureDevOpsSyncStatus,
} from "../../../../shared/types";

interface UseAzureDevOpsPRsOptions {
  /** Filter PRs by state */
  stateFilter?: 'active' | 'abandoned' | 'completed' | 'all';
}

interface UseAzureDevOpsPRsResult {
  pullRequests: AzureDevOpsPullRequest[];
  isLoading: boolean;
  error: string | null;
  selectedPR: AzureDevOpsPullRequest | null;
  selectedPRId: number | null;
  isConnected: boolean;
  projectName: string | null;
  selectPR: (prId: number | null) => void;
  refresh: () => Promise<void>;
}

export function useAzureDevOpsPRs(
  projectId?: string,
  options: UseAzureDevOpsPRsOptions = {}
): UseAzureDevOpsPRsResult {
  const { stateFilter = 'active' } = options;
  const [pullRequests, setPullRequests] = useState<AzureDevOpsPullRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPRId, setSelectedPRId] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);

  // Track if initial load has happened
  const hasLoadedRef = useRef(false);

  // Check connection and fetch PRs
  const fetchPRs = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    setError(null);

    try {
      // First check connection
      const connectionResult = await window.electronAPI.checkAzureDevOpsConnection(projectId);
      if (connectionResult.success && connectionResult.data) {
        setIsConnected(connectionResult.data.connected);
        setProjectName(connectionResult.data.projectName || null);

        if (connectionResult.data.connected) {
          // Fetch PRs
          const result = await window.electronAPI.getAzureDevOpsPullRequests(projectId, stateFilter);
          if (result.success && result.data) {
            setPullRequests(result.data);
          }
        }
      } else {
        setIsConnected(false);
        setProjectName(null);
        setError(connectionResult.error || "Failed to check connection");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch PRs");
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, stateFilter]);

  // Initial load
  useEffect(() => {
    if (projectId && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      fetchPRs();
    }
  }, [projectId, fetchPRs]);

  // Reset state when project changes
  useEffect(() => {
    hasLoadedRef.current = false;
    setPullRequests([]);
    setSelectedPRId(null);
  }, [projectId]);

  const selectPR = useCallback((prId: number | null) => {
    setSelectedPRId(prId);
  }, []);

  const refresh = useCallback(async () => {
    await fetchPRs();
  }, [fetchPRs]);

  const selectedPR = useMemo(() => {
    return pullRequests.find((pr) => pr.pullRequestId === selectedPRId) || null;
  }, [pullRequests, selectedPRId]);

  return {
    pullRequests,
    isLoading,
    error,
    selectedPR,
    selectedPRId,
    isConnected,
    projectName,
    selectPR,
    refresh,
  };
}
