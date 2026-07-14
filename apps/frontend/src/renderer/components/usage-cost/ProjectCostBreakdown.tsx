/**
 * Project Cost Breakdown - renders the project-level "Spend by Account" and
 * "Spend by Provider" rollups computed by usage-aggregator's getUsageForProject()
 * (`projectSummary.byAccount` / `byModel`). This satisfies the acceptance criterion's
 * "broken down by account and provider" wording at the project level, independent of
 * (and in addition to) the per-task drill-down in TaskCostBreakdownTable.
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { useUsageCostStore } from '../../stores/usage-cost-store';
import { formatCurrency } from './CostSummaryCards';
import { formatTokens, getProviderLabel, getProviderBadgeVariant } from './TaskCostBreakdownTable';
import type { UsageBreakdown, UsageTotals } from '../../../preload/api/modules/usage-cost-api';

interface BreakdownEntry {
  key: string;
  totals: UsageTotals;
}

/** Converts a raw account/model UsageBreakdown map into rows sorted by cost, descending. */
function toSortedEntries(breakdown: UsageBreakdown | undefined): BreakdownEntry[] {
  if (!breakdown) return [];
  return Object.entries(breakdown)
    .map(([key, totals]) => ({ key, totals }))
    .sort((a, b) => b.totals.cost_usd - a.totals.cost_usd);
}

/**
 * Re-groups a model-keyed UsageBreakdown by provider (multiple model identifiers can
 * map to the same provider, e.g. different Claude model versions are all "Anthropic").
 */
function groupByProvider(byModel: UsageBreakdown | undefined): BreakdownEntry[] {
  if (!byModel) return [];
  const grouped = new Map<string, UsageTotals>();

  for (const [model, totals] of Object.entries(byModel)) {
    const provider = getProviderLabel(model);
    const existing = grouped.get(provider) ?? { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    existing.input_tokens += totals.input_tokens || 0;
    existing.output_tokens += totals.output_tokens || 0;
    existing.cost_usd += totals.cost_usd || 0;
    grouped.set(provider, existing);
  }

  return Array.from(grouped.entries())
    .map(([key, totals]) => ({ key, totals }))
    .sort((a, b) => b.totals.cost_usd - a.totals.cost_usd);
}

function BreakdownList({
  entries,
  emptyLabel,
  renderKey
}: {
  entries: BreakdownEntry[];
  emptyLabel: string;
  renderKey: (key: string) => ReactNode;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/50">
      {entries.map((entry) => (
        <li key={entry.key} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="min-w-0 flex-1">{renderKey(entry.key)}</div>
          <div className="flex shrink-0 items-center gap-3 text-right">
            <span className="tabular-nums text-muted-foreground">
              {formatTokens(entry.totals.input_tokens + entry.totals.output_tokens)}
            </span>
            <span className="tabular-nums font-medium text-foreground">
              {formatCurrency(entry.totals.cost_usd)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Project-level "Spend by Account" / "Spend by Provider" panels, sourced directly from
 * `projectSummary.byAccount` / `byModel` (no per-task selection required).
 */
export function ProjectCostBreakdown() {
  const { t } = useTranslation(['common']);
  const projectSummary = useUsageCostStore((state) => state.projectSummary);

  const accountEntries = useMemo(() => toSortedEntries(projectSummary?.byAccount), [projectSummary]);
  const providerEntries = useMemo(() => groupByProvider(projectSummary?.byModel), [projectSummary]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card data-testid="account-breakdown-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-muted-foreground" />
            {t('common:usageCostDashboard.accountBreakdown.title')}
          </CardTitle>
          <CardDescription>{t('common:usageCostDashboard.accountBreakdown.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <BreakdownList
            entries={accountEntries}
            emptyLabel={t('common:usageCostDashboard.accountBreakdown.empty')}
            renderKey={(key) => <span className="font-medium text-foreground">{key}</span>}
          />
        </CardContent>
      </Card>

      <Card data-testid="provider-breakdown-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-muted-foreground" />
            {t('common:usageCostDashboard.providerBreakdown.title')}
          </CardTitle>
          <CardDescription>{t('common:usageCostDashboard.providerBreakdown.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <BreakdownList
            entries={providerEntries}
            emptyLabel={t('common:usageCostDashboard.providerBreakdown.empty')}
            renderKey={(key) => <Badge variant={getProviderBadgeVariant(key)}>{key}</Badge>}
          />
        </CardContent>
      </Card>
    </div>
  );
}
