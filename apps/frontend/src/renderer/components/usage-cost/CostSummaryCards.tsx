import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, Coins, Activity } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';
import { useUsageCostStore } from '../../stores/usage-cost-store';
import { formatCurrency, formatTokens } from './format';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  className?: string;
}

function StatCard({ icon, label, value, subtext, className }: StatCardProps) {
  return (
    <Card className={cn('transition-all duration-200', className)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        {subtext && <div className="mt-1 text-xs text-muted-foreground">{subtext}</div>}
      </CardContent>
    </Card>
  );
}

/**
 * Row of KPI stat cards summarizing project-level spend: total cost, total tokens,
 * and the cost of the currently active/in-progress run (if any task detail is loaded).
 */
export function CostSummaryCards() {
  const { t } = useTranslation(['common']);
  const projectSummary = useUsageCostStore((state) => state.projectSummary);
  const taskDetail = useUsageCostStore((state) => state.taskDetail);
  const isLoading = useUsageCostStore((state) => state.isLoading);

  const totalCost = projectSummary?.totals.cost_usd ?? 0;
  const totalTokens = useMemo(() => {
    if (!projectSummary) return 0;
    return projectSummary.totals.input_tokens + projectSummary.totals.output_tokens;
  }, [projectSummary]);

  const activeRunCost = taskDetail?.totals.cost_usd;
  const activeRunTokens = taskDetail
    ? taskDetail.totals.input_tokens + taskDetail.totals.output_tokens
    : undefined;

  const specCount = projectSummary?.specCount ?? 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        icon={<DollarSign className="h-3.5 w-3.5" />}
        label={t('common:usageCostDashboard.totalSpend')}
        value={isLoading && !projectSummary ? '—' : formatCurrency(totalCost)}
        subtext={
          specCount > 0
            ? t('common:usageCostDashboard.acrossSpecs', { count: specCount })
            : undefined
        }
      />
      <StatCard
        icon={<Coins className="h-3.5 w-3.5" />}
        label={t('common:usageCostDashboard.totalTokens')}
        value={isLoading && !projectSummary ? '—' : formatTokens(totalTokens)}
        subtext={
          projectSummary
            ? t('common:usageCostDashboard.inputOutput', {
                input: formatTokens(projectSummary.totals.input_tokens),
                output: formatTokens(projectSummary.totals.output_tokens)
              })
            : undefined
        }
      />
      <StatCard
        icon={<Activity className="h-3.5 w-3.5" />}
        label={t('common:usageCostDashboard.activeRunCost')}
        value={activeRunCost != null ? formatCurrency(activeRunCost) : '—'}
        subtext={
          activeRunTokens != null
            ? t('common:usageCostDashboard.inputOutput', {
                input: formatTokens(taskDetail?.totals.input_tokens ?? 0),
                output: formatTokens(taskDetail?.totals.output_tokens ?? 0)
              })
            : t('common:usageCostDashboard.activeRunCostNone')
        }
      />
    </div>
  );
}
