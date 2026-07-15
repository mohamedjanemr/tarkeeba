/**
 * Task Cost Breakdown Table - per-task token usage and estimated cost, broken down
 * by account and provider (satisfies the acceptance criterion: "per-task token usage
 * and estimated cost ... broken down by account and provider").
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Table as TableIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { useUsageCostStore } from '../../stores/usage-cost-store';
import { formatCurrency, formatTokens, getProviderLabelFromModel, getProviderBadgeVariant } from './format';
import type { UsageEntry, UsageTotals } from '../../../preload/api/modules/usage-cost-api';

interface BreakdownRow extends UsageTotals {
  account: string;
  provider: string;
}

function emptyTotals(): UsageTotals {
  return { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
}

/** Groups usage entries by account + provider pair, summing token/cost totals for each group. */
function groupByAccountAndProvider(entries: UsageEntry[]): BreakdownRow[] {
  const groups = new Map<string, BreakdownRow>();

  for (const entry of entries) {
    const account = entry.account || 'unknown';
    const provider = getProviderLabelFromModel(entry.model || '');
    const key = `${account}::${provider}`;

    const existing = groups.get(key) ?? { account, provider, ...emptyTotals() };
    existing.input_tokens += entry.input_tokens || 0;
    existing.output_tokens += entry.output_tokens || 0;
    existing.cost_usd += entry.cost_usd || 0;
    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort((a, b) => b.cost_usd - a.cost_usd);
}

/**
 * Table breaking down the currently-viewed task's token usage and estimated cost by
 * account and provider, sourced from the usage-cost store's `taskDetail.entries`.
 */
export function TaskCostBreakdownTable() {
  const { t } = useTranslation(['common']);
  const taskDetail = useUsageCostStore((state) => state.taskDetail);

  const rows = useMemo(() => {
    if (!taskDetail?.entries) return [];
    return groupByAccountAndProvider(taskDetail.entries);
  }, [taskDetail]);

  const hasData = rows.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TableIcon className="h-4 w-4 text-muted-foreground" />
          {t('common:usageCostDashboard.taskCostBreakdown.title')}
        </CardTitle>
        <CardDescription>{t('common:usageCostDashboard.taskCostBreakdown.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t('common:usageCostDashboard.taskCostBreakdown.account')}</th>
                  <th className="py-2 pr-4 font-medium">{t('common:usageCostDashboard.taskCostBreakdown.provider')}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t('common:usageCostDashboard.taskCostBreakdown.inputTokens')}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t('common:usageCostDashboard.taskCostBreakdown.outputTokens')}</th>
                  <th className="py-2 text-right font-medium">{t('common:usageCostDashboard.taskCostBreakdown.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.account}::${row.provider}`} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 font-medium text-foreground">{row.account}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={getProviderBadgeVariant(row.provider)}>{row.provider}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                      {formatTokens(row.input_tokens)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                      {formatTokens(row.output_tokens)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium text-foreground">
                      {formatCurrency(row.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            {t('common:usageCostDashboard.taskCostBreakdown.empty')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
