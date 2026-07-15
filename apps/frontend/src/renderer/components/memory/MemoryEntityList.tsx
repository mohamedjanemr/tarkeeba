import { useTranslation } from 'react-i18next';
import { Boxes, Clock, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { formatDate } from '../context/utils';
import type { MemoryEntity } from '../../../shared/types';

interface MemoryEntityListProps {
  entities: MemoryEntity[];
  onSelect: (entity: MemoryEntity) => void;
}

/**
 * Lists knowledge-graph entities for the active project. Each row opens the
 * entry detail dialog for viewing/editing/pruning.
 */
export function MemoryEntityList({ entities, onSelect }: MemoryEntityListProps) {
  const { t } = useTranslation('memory');

  return (
    <div className="space-y-3">
      {entities.map((entity) => (
        <button key={entity.id} type="button" className="w-full text-left" onClick={() => onSelect(entity)}>
          <Card className="border-border/50 bg-muted/30 transition-colors hover:border-border">
            <CardContent className="flex items-start gap-3 py-4">
              <div className="rounded-lg bg-accent/10 p-2">
                <Boxes className="h-4 w-4 text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{entity.name}</span>
                  {entity.type && (
                    <Badge variant="outline" className="shrink-0 text-xs capitalize">
                      {entity.type.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
                {entity.summary && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{entity.summary}</p>
                )}
                <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDate(entity.timestamp)}
                </div>
              </div>
              <ChevronRight className={cn('h-4 w-4 shrink-0 self-center text-muted-foreground')} />
            </CardContent>
          </Card>
        </button>
      ))}
      {entities.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('empty.entities')}</p>
      )}
    </div>
  );
}
