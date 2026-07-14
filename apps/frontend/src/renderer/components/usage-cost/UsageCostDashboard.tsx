/**
 * Usage & Cost Dashboard - top-level view composing the KPI summary cards, spend-over-time
 * chart, account headroom panel, project-level account/provider breakdown, and per-task
 * cost breakdown table. Loads the active project's usage summary (and live-refreshes it via
 * IPC) on mount / project change, and drives the per-task breakdown via a task picker that
 * defaults to the most recently updated task.
 */

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, AlertCircle, ListChecks } from 'lucide-react';
import { CostSummaryCards } from './CostSummaryCards';
import { SpendOverTimeChart } from './SpendOverTimeChart';
import { AccountHeadroomPanel } from './AccountHeadroomPanel';
import { ProjectCostBreakdown } from './ProjectCostBreakdown';
import { TaskCostBreakdownTable } from './TaskCostBreakdownTable';
import { SpendThresholdSettings } from './SpendThresholdSettings';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  useUsageCostStore,
  loadProjectUsageSummary,
  loadTaskUsageDetail,
  setupUsageCostListeners
} from '../../stores/usage-cost-store';
import { useTaskStore } from '../../stores/task-store';
import { debugError } from '../../../shared/utils/debug-logger';

interface UsageCostDashboardProps {
  projectId: string;
}

/**
 * Composes the Usage & Cost dashboard for the active project: KPI cards, historical
 * spend chart, per-account rate-limit headroom, project-level account/provider spend,
 * and a task-scoped cost breakdown driven by a task picker.
 */
export function UsageCostDashboard({ projectId }: UsageCostDashboardProps) {
  const { t } = useTranslation(['common', 'navigation']);
  const error = useUsageCostStore((state) => state.error);
  const selectedSpecId = useUsageCostStore((state) => state.selectedSpecId);
  const setSelectedSpecId = useUsageCostStore((state) => state.setSelectedSpecId);
  const tasks = useTaskStore((state) => state.tasks);

  // Tasks belonging to this project that have a spec ID, most-recently-updated first,
  // so the picker defaults to the most relevant task without requiring the user to hunt.
  const projectTasks = useMemo(() => {
    return tasks
      .filter((task) => task.projectId === projectId && !!task.specId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [tasks, projectId]);

  useEffect(() => {
    if (!projectId) return;

    loadProjectUsageSummary(projectId).catch((err) => {
      debugError('Failed to load usage summary:', err);
    });

    const cleanup = setupUsageCostListeners(projectId);
    return cleanup;
  }, [projectId]);

  // Default-select the most recently updated task once this project's tasks are known.
  // Also re-selects if the current selection no longer exists (e.g. task deleted) or the
  // project changed, so the picker/breakdown never gets stuck on a stale/foreign spec ID.
  useEffect(() => {
    if (projectTasks.length === 0) {
      if (selectedSpecId !== null) {
        setSelectedSpecId(null);
      }
      return;
    }

    const stillExists = projectTasks.some((task) => task.specId === selectedSpecId);
    if (!selectedSpecId || !stillExists) {
      setSelectedSpecId(projectTasks[0].specId);
    }
  }, [projectTasks, selectedSpecId, setSelectedSpecId]);

  // Load the selected task's usage detail (per-task/account/provider breakdown + the
  // "Active Run Cost" KPI) whenever the project or selection changes.
  useEffect(() => {
    if (!projectId || !selectedSpecId) return;

    loadTaskUsageDetail(projectId, selectedSpecId).catch((err) => {
      debugError('Failed to load task usage detail:', err);
    });
  }, [projectId, selectedSpecId]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">{t('navigation:items.usageCost')}</h1>
          </div>

          {projectTasks.length > 0 && (
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Select
                value={selectedSpecId ?? undefined}
                onValueChange={(value) => setSelectedSpecId(value || null)}
              >
                <SelectTrigger
                  className="w-64"
                  aria-label={t('common:usageCostDashboard.taskSelector.label')}
                >
                  <SelectValue placeholder={t('common:usageCostDashboard.taskSelector.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {projectTasks.map((task) => (
                    <SelectItem key={task.specId} value={task.specId}>
                      {task.title || task.specId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <CostSummaryCards />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SpendOverTimeChart />
          <AccountHeadroomPanel />
        </div>

        <ProjectCostBreakdown />

        <TaskCostBreakdownTable />

        <SpendThresholdSettings />
      </div>
    </div>
  );
}
