import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { IPC_CHANNELS, getSpecsDir } from "../../shared/constants";
import type { IPCResult, AllProfilesUsage } from "../../shared/types";
import { projectStore } from "../project-store";
import { getUsageMonitor } from "../claude-profile/usage-monitor";
import {
  usageAggregator,
  type ProjectUsageSummary,
  type UsageData,
  type HistoricalAverageCost,
  type HistoricalAverageCostOptions,
} from "../usage-cost/usage-aggregator";
import { safeSendToRenderer } from "./utils";

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
 * Register all Usage & Cost dashboard IPC handlers.
 *
 * Wires apps/frontend's usage-aggregator.ts (per-spec usage.json aggregation) and
 * usage-monitor.ts (account rate-limit headroom) into a small set of IPC channels
 * consumed by the renderer's Usage & Cost dashboard.
 */
export function registerUsageCostHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ============================================
  // Usage & Cost Dashboard Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.USAGE_COST_GET_PROJECT_SUMMARY,
    async (_, projectId: string): Promise<IPCResult<UsageCostProjectSummary>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      try {
        const usage = usageAggregator.getUsageForProject(project);

        // Compose in account/rate-limit headroom so the dashboard can show cost AND
        // rate-limit headroom from a single summary call. Non-fatal if unavailable.
        let accountHeadroom: AllProfilesUsage | null = null;
        try {
          const monitor = getUsageMonitor();
          accountHeadroom = await monitor.getAllProfilesUsage();
        } catch (headroomError) {
          console.error("[UsageCost IPC] Failed to collect account headroom:", headroomError);
        }

        return { success: true, data: { usage, accountHeadroom } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get project usage summary",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.USAGE_COST_GET_TASK_DETAIL,
    async (_, projectId: string, specId: string): Promise<IPCResult<UsageData | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      try {
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const usage = usageAggregator.getUsageForSpec(project.path, specsBaseDir, specId);
        return { success: true, data: usage };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get task usage detail",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.USAGE_COST_PREDICT,
    async (
      _,
      projectId: string,
      options?: HistoricalAverageCostOptions
    ): Promise<IPCResult<HistoricalAverageCost>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      try {
        const prediction = usageAggregator.getHistoricalAverageCost(project, options ?? {});
        return { success: true, data: prediction };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to predict spend",
        };
      }
    }
  );

  // Forward live usage.json changes (from usage-aggregator's fs watchers) to the renderer
  // so the dashboard can refresh without polling.
  usageAggregator.on("usage-updated", ({ specId }: { specDir: string; specId: string }) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.USAGE_COST_UPDATED, specId);
  });
}
