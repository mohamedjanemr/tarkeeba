import { useTranslation } from 'react-i18next';
import { ArrowRight, Clock } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { formatDate } from '../context/utils';
import type { MemoryRelationship } from '../../../shared/types';

interface MemoryRelationshipListProps {
  relationships: MemoryRelationship[];
}

/**
 * Lists entity-to-entity relationships as source -> fact -> target rows.
 */
export function MemoryRelationshipList({ relationships }: MemoryRelationshipListProps) {
  const { t } = useTranslation('memory');

  return (
    <div className="space-y-3">
      {relationships.map((rel) => (
        <Card key={rel.id} className="border-border/50 bg-muted/30">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md bg-accent/10 px-2 py-1 font-medium text-foreground">
                {rel.source}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="italic text-muted-foreground">{rel.fact}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="rounded-md bg-accent/10 px-2 py-1 font-medium text-foreground">
                {rel.target}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDate(rel.timestamp)}
            </div>
          </CardContent>
        </Card>
      ))}
      {relationships.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('empty.relationships')}</p>
      )}
    </div>
  );
}
