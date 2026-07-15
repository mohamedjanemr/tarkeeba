import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Calendar } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { formatDate } from '../context/utils';
import { memoryTypeIcons, memoryTypeColors, memoryTypeLabels } from '../context/constants';
import type { MemoryTimelineEntry } from '../../../shared/types';

interface InsightTimelineProps {
  entries: MemoryTimelineEntry[];
  onSelect: (entry: MemoryTimelineEntry) => void;
}

// Groups timeline entries into chronological day buckets (newest first).
function groupByDay(entries: MemoryTimelineEntry[]): Array<{ day: string; items: MemoryTimelineEntry[] }> {
  const buckets = new Map<string, MemoryTimelineEntry[]>();
  for (const entry of entries) {
    let day = entry.date;
    if (!day) {
      try {
        day = new Date(entry.timestamp).toLocaleDateString();
      } catch {
        day = entry.timestamp;
      }
    }
    const existing = buckets.get(day);
    if (existing) {
      existing.push(entry);
    } else {
      buckets.set(day, [entry]);
    }
  }
  return Array.from(buckets.entries()).map(([day, items]) => ({ day, items }));
}

/**
 * Chronological insight timeline: episodes grouped by day, each labelled by
 * memory type. Clicking an entry opens its detail dialog.
 */
export function InsightTimeline({ entries, onSelect }: InsightTimelineProps) {
  const { t } = useTranslation('memory');
  const groups = useMemo(() => groupByDay(entries), [entries]);

  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('empty.timeline')}</p>;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.day}>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            {group.day}
          </div>
          <div className="space-y-2 border-l border-border/60 pl-4">
            {group.items.map((entry) => {
              const Icon = memoryTypeIcons[entry.type] || memoryTypeIcons.session_insight;
              const typeColor = memoryTypeColors[entry.type] || '';
              const typeLabel = memoryTypeLabels[entry.type] || entry.type.replace(/_/g, ' ');
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="w-full text-left"
                  onClick={() => onSelect(entry)}
                >
                  <Card className="border-border/50 bg-muted/30 transition-colors hover:border-border">
                    <CardContent className="flex items-start gap-3 py-3">
                      <div className="rounded-lg bg-accent/10 p-2">
                        <Icon className="h-4 w-4 text-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn('text-xs capitalize', typeColor)}>
                            {typeLabel}
                          </Badge>
                          {entry.session_number != null && (
                            <span className="text-xs text-muted-foreground">
                              {t('timeline.session', { number: entry.session_number })}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{entry.content}</p>
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(entry.timestamp)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
