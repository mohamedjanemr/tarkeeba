/**
 * Usage & Cost Dashboard - top-level view composing the KPI summary cards, spend-over-time
 * chart, account headroom panel, and per-task cost breakdown table. Loads the active
 * project's usage summary (and live-refreshes it via IPC) on mount / project change.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, AlertCircle } from 'lucide-react';
import { CostSummaryCards } from './CostSummaryCards';
import { SpendOverTimeChart } from './SpendOverTimeChart';
import { AccountHeadroomPanel } from './AccountHeadroomPanel';
import { TaskCostBreakdownTable } from './TaskCostBreakdownTable';
import { useUsageCostStore, loadProjectUsageSummary, setupUsageCostListeners } from '../../stores/usage-cost-store';

interface UsageCostDashboardProps {
  projectId: string;
}

/**
 * Composes the Usage & Cost dashboard for the active project: KPI cards, historical
 * spend chart, per-account rate-limit headroom, and per-task cost breakdown.
 */
export function UsageCostDashboard({ projectId }: UsageCostDashboardProps) {
  const { t } = useTranslation(['common', 'navigation']);
  const error = useUsageCostStore((state) => state.error);

  useEffect(() => {
    if (!projectId) return;

    loadProjectUsageSummary(projectId).catch((err) => {
      console.error('Failed to load usage summary:', err);
    });

    const cleanup = setupUsageCostListeners(projectId);
    return cleanup;
  }, [projectId]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">{t('navigation:items.usageCost')}</h1>
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

        <TaskCostBreakdownTable />
      </div>
    </div>
  );
}
