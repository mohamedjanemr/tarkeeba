import path from 'path';
import { existsSync, readFileSync, readdirSync, Dirent } from 'fs';
import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import type { Project } from '../../shared/types';
import type { ImplementationPlan } from '../../shared/types/task';
import { AUTO_BUILD_PATHS, getSpecsDir } from '../../shared/constants/config';
import { findAllSpecPaths } from '../utils/spec-path-helpers';
import { debugLog, debugWarn, debugError } from '../../shared/utils/debug-logger';

/** File name for the per-spec usage/cost tracking data written by the backend. */
const USAGE_FILE_NAME = 'usage.json';

/**
 * A single usage/cost record captured for one agent-SDK result message.
 * Mirrors apps/backend/task_logger/models.py::UsageEntry.to_dict().
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

function emptyTotals(): UsageTotals {
  return { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
}

function addTotals(target: UsageTotals, entry: UsageEntry): void {
  target.input_tokens += entry.input_tokens || 0;
  target.output_tokens += entry.output_tokens || 0;
  target.cost_usd = round6(target.cost_usd + (entry.cost_usd || 0));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Merge multiple copies of the same spec's usage.json (main dir + worktree copies) into one.
 * Entries are de-duplicated using a composite key so a spec that has synced back to the main
 * project (but still has a lingering worktree copy) isn't double-counted.
 */
function mergeUsageData(specId: string, sources: UsageData[]): UsageData | null {
  if (sources.length === 0) return null;

  const seen = new Set<string>();
  const entries: UsageEntry[] = [];
  let createdAt: string | undefined;
  let updatedAt: string | undefined;

  for (const data of sources) {
    if (data.created_at && (!createdAt || data.created_at < createdAt)) {
      createdAt = data.created_at;
    }
    if (data.updated_at && (!updatedAt || data.updated_at > updatedAt)) {
      updatedAt = data.updated_at;
    }

    for (const entry of data.entries || []) {
      const key = [
        entry.timestamp,
        entry.phase ?? '',
        entry.subtask_id ?? '',
        entry.session ?? '',
        entry.model,
        entry.account
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  const totals = entries.reduce((acc, entry) => {
    addTotals(acc, entry);
    return acc;
  }, emptyTotals());

  return { spec_id: specId, created_at: createdAt, updated_at: updatedAt, entries, totals };
}

/**
 * Reads, caches, and watches per-spec `usage.json` files, and provides
 * project-level roll-ups (by account/model, historical time-series, and
 * historical-average cost predictions) for the Usage & Cost dashboard.
 *
 * Follows the same tolerate-partial-JSON caching approach as task-log-service.ts
 * (usage.json may be mid-write by a concurrent backend phase) and the same
 * fs-watch pattern as file-watcher.ts (watching implementation_plan.json) so the
 * dashboard can live-update while a task is actively running.
 */
export class UsageAggregator extends EventEmitter {
  /** Cache of parsed usage.json contents, keyed by the spec directory that contains it. */
  private usageCache: Map<string, UsageData> = new Map();
  /** Active fs watchers, keyed by the spec directory being watched. */
  private watchers: Map<string, FSWatcher> = new Map();

  /**
   * Load and parse a single spec directory's usage.json.
   * Returns the cached copy if the file is corrupted (e.g. mid-write by the Python backend).
   */
  private loadUsageFromPath(specDir: string): UsageData | null {
    const usageFile = path.join(specDir, USAGE_FILE_NAME);

    if (!existsSync(usageFile)) {
      debugLog('[UsageAggregator.loadUsageFromPath] Usage file does not exist:', usageFile);
      return null;
    }

    try {
      const content = readFileSync(usageFile, 'utf-8');
      const data = JSON.parse(content) as UsageData;
      // Defensive defaults in case the backend hasn't written totals/entries yet
      data.entries = data.entries || [];
      data.totals = data.totals || emptyTotals();
      this.usageCache.set(specDir, data);
      return data;
    } catch (error) {
      const cached = this.usageCache.get(specDir);
      if (cached) {
        debugWarn('[UsageAggregator.loadUsageFromPath] Parse error, returning cached usage data:', {
          specDir,
          error: error instanceof Error ? error.message : String(error)
        });
        return cached;
      }
      debugError('[UsageAggregator.loadUsageFromPath] Failed to load usage data (no cache):', {
        usageFile,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Watch a spec directory's usage.json for live updates while a task is running.
   * Safe to call repeatedly for the same specDir - subsequent calls are no-ops.
   */
  private watchUsageFile(specDir: string): void {
    if (this.watchers.has(specDir)) return;

    const usageFile = path.join(specDir, USAGE_FILE_NAME);
    if (!existsSync(usageFile)) return;

    try {
      const watcher = chokidar.watch(usageFile, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      watcher.on('change', () => {
        const data = this.loadUsageFromPath(specDir);
        if (data) {
          this.emit('usage-updated', { specDir, specId: data.spec_id });
        }
      });

      watcher.on('error', (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emit('error', { specDir, message });
      });

      this.watchers.set(specDir, watcher);
    } catch (error) {
      debugError('[UsageAggregator.watchUsageFile] Failed to start watcher:', {
        specDir,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Stop watching a specific spec directory's usage.json.
   */
  async unwatchSpecDir(specDir: string): Promise<void> {
    const watcher = this.watchers.get(specDir);
    if (watcher) {
      this.watchers.delete(specDir);
      await watcher.close();
    }
  }

  /**
   * Stop all active usage.json watchers. Useful on app shutdown or project switch.
   */
  async unwatchAll(): Promise<void> {
    const closePromises = Array.from(this.watchers.values()).map((watcher) => watcher.close());
    this.watchers.clear();
    await Promise.all(closePromises);
  }

  /**
   * Enumerate all spec IDs that currently exist in a project (main specs dir only -
   * matches the source-of-truth enumeration used by project-store.ts::getTasks()).
   */
  private listSpecIds(project: Project): string[] {
    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const mainSpecsDir = path.join(project.path, specsBaseDir);

    if (!existsSync(mainSpecsDir)) return [];

    let entries: Dirent[] = [];
    try {
      entries = readdirSync(mainSpecsDir, { withFileTypes: true });
    } catch (error) {
      debugError('[UsageAggregator.listSpecIds] Error reading specs directory:', {
        mainSpecsDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }

    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== '.gitkeep')
      .map((entry) => entry.name);
  }

  /**
   * Read implementation_plan.json for a spec (main dir first, then worktree copies)
   * to determine its status/workflow_type for historical-average filtering.
   */
  private loadPlanForSpec(projectPath: string, specsBaseDir: string, specId: string): ImplementationPlan | null {
    const paths = findAllSpecPaths(projectPath, specsBaseDir, specId, '[UsageAggregator]');
    for (const specDir of paths) {
      const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
      if (!existsSync(planPath)) continue;
      try {
        const content = readFileSync(planPath, 'utf-8');
        return JSON.parse(content) as ImplementationPlan;
      } catch {
        // Tolerate partial/mid-write JSON; try the next path (e.g. worktree copy)
      }
    }
    return null;
  }

  /**
   * Get merged usage data for a single spec, reading usage.json from every location
   * the spec exists in (main project dir + any worktree copies) and de-duplicating entries.
   * Also (re-)establishes live-watchers on each usage.json found so future changes are
   * picked up automatically.
   */
  getUsageForSpec(projectPath: string, specsBaseDir: string, specId: string): UsageData | null {
    const specDirs = findAllSpecPaths(projectPath, specsBaseDir, specId, '[UsageAggregator]');
    if (specDirs.length === 0) return null;

    const datas: UsageData[] = [];
    for (const specDir of specDirs) {
      const data = this.loadUsageFromPath(specDir);
      if (data) datas.push(data);
      // Start (or continue) watching this location for live updates
      this.watchUsageFile(specDir);
    }

    return mergeUsageData(specId, datas);
  }

  /**
   * Roll up usage/cost across every spec in a project: overall totals, totals by account,
   * totals by model, and a date -> cost time-series for the historical spend chart.
   */
  getUsageForProject(project: Project): ProjectUsageSummary {
    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const specIds = this.listSpecIds(project);

    const totals = emptyTotals();
    const byAccount: UsageBreakdown = {};
    const byModel: UsageBreakdown = {};
    const timeSeries: UsageTimeSeries = {};

    for (const specId of specIds) {
      const usage = this.getUsageForSpec(project.path, specsBaseDir, specId);
      if (!usage) continue;

      for (const entry of usage.entries) {
        addTotals(totals, entry);

        const account = entry.account || 'unknown';
        byAccount[account] = byAccount[account] || emptyTotals();
        addTotals(byAccount[account], entry);

        const model = entry.model || 'unknown';
        byModel[model] = byModel[model] || emptyTotals();
        addTotals(byModel[model], entry);

        const date = (entry.timestamp || '').slice(0, 10); // YYYY-MM-DD
        if (date) {
          timeSeries[date] = round6((timeSeries[date] || 0) + (entry.cost_usd || 0));
        }
      }
    }

    return {
      projectId: project.id,
      totals,
      byAccount,
      byModel,
      timeSeries,
      specCount: specIds.length
    };
  }

  /**
   * Compute the mean/median cost across past completed specs' usage.json totals,
   * optionally filtered by model (any entry in the spec used this model) and/or
   * workflow_type (from the spec's implementation_plan.json). Used for pre-run
   * spend prediction before a new task of the same shape is started.
   */
  getHistoricalAverageCost(project: Project, options: HistoricalAverageCostOptions = {}): HistoricalAverageCost {
    const specsBaseDir = getSpecsDir(project.autoBuildPath);
    const specIds = this.listSpecIds(project);
    const { model, workflowType } = options;

    const costs: number[] = [];

    for (const specId of specIds) {
      const plan = this.loadPlanForSpec(project.path, specsBaseDir, specId);
      // Only consider completed specs as historical data points for prediction
      if (!plan || plan.status !== 'done') continue;
      if (workflowType && plan.workflow_type !== workflowType) continue;

      const usage = this.getUsageForSpec(project.path, specsBaseDir, specId);
      if (!usage || usage.entries.length === 0) continue;

      if (model) {
        const matchingEntries = usage.entries.filter((entry) => entry.model === model);
        if (matchingEntries.length === 0) continue;
        const modelCost = matchingEntries.reduce((sum, entry) => sum + (entry.cost_usd || 0), 0);
        costs.push(round6(modelCost));
      } else {
        costs.push(usage.totals.cost_usd || 0);
      }
    }

    if (costs.length === 0) {
      return { mean: 0, median: 0, sampleSize: 0 };
    }

    const mean = round6(costs.reduce((sum, cost) => sum + cost, 0) / costs.length);

    const sorted = [...costs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? round6((sorted[mid - 1] + sorted[mid]) / 2)
      : round6(sorted[mid]);

    return { mean, median, sampleSize: costs.length };
  }
}

/** Shared singleton instance, mirroring the pattern used by other main-process services. */
export const usageAggregator = new UsageAggregator();
