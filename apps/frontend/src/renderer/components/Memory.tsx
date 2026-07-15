import { ErrorBoundary } from './ui/error-boundary';
import { MemoryBrowser } from './memory/MemoryBrowser';

interface MemoryProps {
  projectId: string;
}

/**
 * Top-level Memory view. Surfaces the per-project knowledge graph (entities,
 * relationships) and the insight timeline with search and edit/prune controls.
 */
export function Memory({ projectId }: MemoryProps) {
  return (
    <ErrorBoundary>
      <MemoryBrowser projectId={projectId} />
    </ErrorBoundary>
  );
}
