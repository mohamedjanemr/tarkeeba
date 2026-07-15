import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { useUsageCostStore } from '../../stores/usage-cost-store';
import { formatCurrency } from './format';

interface SpendPoint {
  date: string;
  cost: number;
}

/** Formats a YYYY-MM-DD date key as a short locale-aware label (e.g. "Jan 5"). */
function formatDateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  const { t } = useTranslation(['common']);
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0];
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{typeof label === 'string' ? formatDateLabel(label) : label}</div>
      <div className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: 'var(--color-primary)' }}
        />
        <span className="text-muted-foreground">{t('common:usageCostDashboard.spendOverTime.tooltipCost')}:</span>
        <span className="font-medium tabular-nums">{formatCurrency(Number(point.value ?? 0))}</span>
      </div>
    </div>
  );
}

/**
 * Historical per-project spend visualized as a time-series area chart, sourced from
 * the usage-cost store's `projectSummary.timeSeries` (date -> cost for that day).
 */
export function SpendOverTimeChart() {
  const { t } = useTranslation(['common']);
  const projectSummary = useUsageCostStore((state) => state.projectSummary);

  const data: SpendPoint[] = useMemo(() => {
    if (!projectSummary?.timeSeries) return [];
    return Object.entries(projectSummary.timeSeries)
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [projectSummary]);

  const hasData = data.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChartIcon className="h-4 w-4 text-muted-foreground" />
          {t('common:usageCostDashboard.spendOverTime.title')}
        </CardTitle>
        <CardDescription>{t('common:usageCostDashboard.spendOverTime.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="spendOverTimeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateLabel}
                  tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-border)' }}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(value: number) => formatCurrency(value)}
                  tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  label={{
                    value: t('common:usageCostDashboard.spendOverTime.axisCost'),
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--color-muted-foreground)', fontSize: 11 },
                    dy: 40
                  }}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-border)' }} />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  fill="url(#spendOverTimeFill)"
                  activeDot={{ r: 4, fill: 'var(--color-primary)', strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            {t('common:usageCostDashboard.spendOverTime.empty')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
