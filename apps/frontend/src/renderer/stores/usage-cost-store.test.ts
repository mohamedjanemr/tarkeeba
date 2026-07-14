/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for usage-cost-store
 * Tests store state updates for project summary, task detail, and cost prediction
 * loading, covering both success and failure IPC paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the electronAPI for IPC communication
const mockGetProjectUsageSummary = vi.fn();
const mockGetTaskUsageDetail = vi.fn();
const mockPredictTaskCost = vi.fn();
const mockOnUsageCostUpdated = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    getProjectUsageSummary: mockGetProjectUsageSummary,
    getTaskUsageDetail: mockGetTaskUsageDetail,
    predictTaskCost: mockPredictTaskCost,
    onUsageCostUpdated: mockOnUsageCostUpdated
  }
});

describe('usage-cost-store', () => {
  let useUsageCostStore: typeof import('./usage-cost-store').useUsageCostStore;
  let loadProjectUsageSummary: typeof import('./usage-cost-store').loadProjectUsageSummary;
  let loadTaskUsageDetail: typeof import('./usage-cost-store').loadTaskUsageDetail;
  let predictCost: typeof import('./usage-cost-store').predictCost;
  let setupUsageCostListeners: typeof import('./usage-cost-store').setupUsageCostListeners;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const storeModule = await import('./usage-cost-store');
    useUsageCostStore = storeModule.useUsageCostStore;
    loadProjectUsageSummary = storeModule.loadProjectUsageSummary;
    loadTaskUsageDetail = storeModule.loadTaskUsageDetail;
    predictCost = storeModule.predictCost;
    setupUsageCostListeners = storeModule.setupUsageCostListeners;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Store initialization', () => {
    it('should initialize with default state', () => {
      const state = useUsageCostStore.getState();

      expect(state.projectSummary).toBeNull();
      expect(state.taskDetail).toBeNull();
      expect(state.prediction).toBeNull();
      expect(state.accountHeadroom).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('Store setters', () => {
    it('should set loading state', () => {
      const store = useUsageCostStore.getState();
      store.setLoading(true);
      expect(useUsageCostStore.getState().isLoading).toBe(true);
    });

    it('should set error state', () => {
      const store = useUsageCostStore.getState();
      store.setError('Something went wrong');
      expect(useUsageCostStore.getState().error).toBe('Something went wrong');
    });
  });

  describe('loadProjectUsageSummary', () => {
    it('should update projectSummary and accountHeadroom on success', async () => {
      const usage = {
        projectId: 'project-1',
        totals: { input_tokens: 100, output_tokens: 200, cost_usd: 1.23 },
        byAccount: {},
        byModel: {},
        timeSeries: {},
        specCount: 2
      };
      const accountHeadroom = { profiles: [] } as any;

      mockGetProjectUsageSummary.mockResolvedValue({
        success: true,
        data: { usage, accountHeadroom }
      });

      await loadProjectUsageSummary('project-1');

      const state = useUsageCostStore.getState();
      expect(mockGetProjectUsageSummary).toHaveBeenCalledWith('project-1');
      expect(state.projectSummary).toEqual(usage);
      expect(state.accountHeadroom).toEqual(accountHeadroom);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('should set error and leave projectSummary unset on failure', async () => {
      mockGetProjectUsageSummary.mockResolvedValue({
        success: false,
        error: 'Failed to load usage summary'
      });

      await loadProjectUsageSummary('project-1');

      const state = useUsageCostStore.getState();
      expect(state.projectSummary).toBeNull();
      expect(state.error).toBe('Failed to load usage summary');
      expect(state.isLoading).toBe(false);
    });

    it('should fall back to default error message when none provided', async () => {
      mockGetProjectUsageSummary.mockResolvedValue({ success: false });

      await loadProjectUsageSummary('project-1');

      expect(useUsageCostStore.getState().error).toBe('Failed to load usage summary');
    });

    it('should set loading true during the call and false after completion', async () => {
      let resolveCall: (value: any) => void;
      const pending = new Promise((resolve) => {
        resolveCall = resolve;
      });
      mockGetProjectUsageSummary.mockReturnValue(pending);

      const loadPromise = loadProjectUsageSummary('project-1');

      expect(useUsageCostStore.getState().isLoading).toBe(true);

      resolveCall!({ success: true, data: { usage: null, accountHeadroom: null } });
      await loadPromise;

      expect(useUsageCostStore.getState().isLoading).toBe(false);
    });
  });

  describe('loadTaskUsageDetail', () => {
    it('should update taskDetail on success', async () => {
      const taskDetail = {
        spec_id: 'spec-1',
        entries: [],
        totals: { input_tokens: 10, output_tokens: 20, cost_usd: 0.5 }
      };

      mockGetTaskUsageDetail.mockResolvedValue({ success: true, data: taskDetail });

      await loadTaskUsageDetail('project-1', 'spec-1');

      expect(mockGetTaskUsageDetail).toHaveBeenCalledWith('project-1', 'spec-1');
      const state = useUsageCostStore.getState();
      expect(state.taskDetail).toEqual(taskDetail);
      expect(state.error).toBeNull();
    });

    it('should default taskDetail to null when data is missing on success', async () => {
      mockGetTaskUsageDetail.mockResolvedValue({ success: true, data: undefined });

      await loadTaskUsageDetail('project-1', 'spec-1');

      expect(useUsageCostStore.getState().taskDetail).toBeNull();
    });

    it('should set error on failure and leave taskDetail unset', async () => {
      mockGetTaskUsageDetail.mockResolvedValue({
        success: false,
        error: 'Failed to load task usage detail'
      });

      await loadTaskUsageDetail('project-1', 'spec-1');

      const state = useUsageCostStore.getState();
      expect(state.taskDetail).toBeNull();
      expect(state.error).toBe('Failed to load task usage detail');
    });
  });

  describe('predictCost', () => {
    it('should update prediction on success', async () => {
      const prediction = { mean: 1.5, median: 1.2, sampleSize: 10 };
      mockPredictTaskCost.mockResolvedValue({ success: true, data: prediction });

      await predictCost('project-1', { model: 'sonnet' });

      expect(mockPredictTaskCost).toHaveBeenCalledWith('project-1', { model: 'sonnet' });
      const state = useUsageCostStore.getState();
      expect(state.prediction).toEqual(prediction);
      expect(state.error).toBeNull();
    });

    it('should set error and leave prediction unset on failure', async () => {
      mockPredictTaskCost.mockResolvedValue({
        success: false,
        error: 'Failed to predict cost'
      });

      await predictCost('project-1');

      const state = useUsageCostStore.getState();
      expect(state.prediction).toBeNull();
      expect(state.error).toBe('Failed to predict cost');
    });

    it('should fall back to default error message when none provided', async () => {
      mockPredictTaskCost.mockResolvedValue({ success: false });

      await predictCost('project-1');

      expect(useUsageCostStore.getState().error).toBe('Failed to predict cost');
    });
  });

  describe('setupUsageCostListeners', () => {
    it('should register the onUsageCostUpdated listener and return its cleanup', () => {
      const unsubscribe = vi.fn();
      mockOnUsageCostUpdated.mockReturnValue(unsubscribe);

      const cleanup = setupUsageCostListeners('project-1');

      expect(mockOnUsageCostUpdated).toHaveBeenCalledTimes(1);

      cleanup();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('should refresh the project summary when an update event fires', async () => {
      let capturedCallback: ((specId: string) => void) | undefined;
      mockOnUsageCostUpdated.mockImplementation((callback) => {
        capturedCallback = callback;
        return vi.fn();
      });
      mockGetProjectUsageSummary.mockResolvedValue({
        success: true,
        data: { usage: { totals: { input_tokens: 1, output_tokens: 1, cost_usd: 1 } }, accountHeadroom: null }
      });

      setupUsageCostListeners('project-1');
      expect(capturedCallback).toBeDefined();

      capturedCallback!('spec-1');

      await vi.waitFor(() => {
        expect(mockGetProjectUsageSummary).toHaveBeenCalledWith('project-1');
      });
    });
  });
});
