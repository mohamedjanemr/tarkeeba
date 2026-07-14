import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, AllProfilesUsage } from '../../../shared/types';
import { createIpcListener, invokeIpc, IpcListenerCleanup } from './ipc-utils';

/**
 * A single usage/cost record captured for one agent-SDK result message.
 * Mirrors apps/frontend/src/main/usage-cost/usage-aggregator.ts::UsageEntry,
 * which in turn mirrors apps/backend/task_logger/models.py::UsageEntry.to_dict().
 */
export interface UsageEntry {
  timestamp: string;
  phase?: string;
  subtask_id?: string;
  session?: number;
  model: string;
  account: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd: number;
  source?: 'sdk_reported' | 'estimated';
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/** Shape of a single spec directory's usage.json file. */
export interface UsageData {
  spec_id: string;
  created_at?: string;
  updated_at?: string;
  entries: UsageEntry[];
  totals: UsageTotals;
}

/** Cost/token totals broken down by an arbitrary key (account, model, etc). */
export type UsageBreakdown = Record<string, UsageTotals>;

/** date (YYYY-MM-DD) -> cost for that day, used to render the historical spend chart. */
export type UsageTimeSeries = Record<string, number>;

export interface ProjectUsageSummary {
  projectId: string;
  totals: UsageTotals;
  byAccount: UsageBreakdown;
  byModel: UsageBreakdown;
  timeSeries: UsageTimeSeries;
  specCount: number;
}

export interface HistoricalAverageCostOptions {
  model?: string;
  workflowType?: string;
}

export interface HistoricalAverageCost {
  mean: number;
  median: number;
  sampleSize: number;
}

/**
 * Combined payload for the Usage & Cost dashboard's main summary call:
 * spend/token roll-up for the project plus rate-limit headroom for all
 * configured accounts, so the dashboard can render both from one IPC round trip.
 */
export interface UsageCostProjectSummary {
  usage: ProjectUsageSummary;
  /** Account/rate-limit headroom data, null if it could not be collected (e.g. no authenticated profiles) */
  accountHeadroom: AllProfilesUsage | null;
}

/**
 * Payload sent when a task's predicted cost exceeds the configured threshold and the
 * spawn is blocked pending user confirmation (see AgentManager.checkCostWarningGate).
 */
export interface CostWarningRequiredPayload {
  taskId: string;
  predictedCostUsd: number;
  threshold: number;
  projectId?: string;
}

/**
 * Usage & Cost dashboard API operations
 */
export interface UsageCostAPI {
  // Operations
  getProjectUsageSummary: (projectId: string) => Promise<IPCResult<UsageCostProjectSummary>>;
  getTaskUsageDetail: (projectId: string, specId: string) => Promise<IPCResult<UsageData | null>>;
  predictTaskCost: (
    projectId: string,
    options?: HistoricalAverageCostOptions
  ) => Promise<IPCResult<HistoricalAverageCost>>;
  confirmCostWarning: (taskId: string, approved: boolean) => Promise<IPCResult<boolean>>;

  // Event Listeners
  onUsageCostUpdated: (callback: (specId: string) => void) => IpcListenerCleanup;
  onCostWarningRequired: (
    callback: (payload: CostWarningRequiredPayload) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Usage & Cost dashboard API implementation
 */
export const createUsageCostApi = (): UsageCostAPI => ({
  // Operations
  getProjectUsageSummary: (projectId: string): Promise<IPCResult<UsageCostProjectSummary>> =>
    invokeIpc(IPC_CHANNELS.USAGE_COST_GET_PROJECT_SUMMARY, projectId),

  getTaskUsageDetail: (projectId: string, specId: string): Promise<IPCResult<UsageData | null>> =>
    invokeIpc(IPC_CHANNELS.USAGE_COST_GET_TASK_DETAIL, projectId, specId),

  predictTaskCost: (
    projectId: string,
    options?: HistoricalAverageCostOptions
  ): Promise<IPCResult<HistoricalAverageCost>> =>
    invokeIpc(IPC_CHANNELS.USAGE_COST_PREDICT, projectId, options),

  confirmCostWarning: (taskId: string, approved: boolean): Promise<IPCResult<boolean>> =>
    invokeIpc(IPC_CHANNELS.TASK_CONFIRM_COST_WARNING, taskId, approved),

  // Event Listeners
  onUsageCostUpdated: (callback: (specId: string) => void): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.USAGE_COST_UPDATED, callback),

  onCostWarningRequired: (
    callback: (payload: CostWarningRequiredPayload) => void
  ): IpcListenerCleanup =>
    createIpcListener(IPC_CHANNELS.COST_WARNING_REQUIRED, callback)
});
