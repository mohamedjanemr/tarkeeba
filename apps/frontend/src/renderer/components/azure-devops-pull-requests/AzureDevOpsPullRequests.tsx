import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, Settings as SettingsIcon, RefreshCw } from 'lucide-react';
import { useAzureDevOpsPRs } from './hooks/useAzureDevOpsPRs';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';

interface AzureDevOpsPullRequestsProps {
  projectId: string;
  onOpenSettings?: () => void;
}

export function AzureDevOpsPullRequests({ projectId, onOpenSettings }: AzureDevOpsPullRequestsProps) {
  const { t } = useTranslation('azure-devops');
  const [stateFilter, setStateFilter] = useState<'active' | 'abandoned' | 'completed' | 'all'>('active');

  const {
    pullRequests,
    isLoading,
    error,
    selectedPR,
    selectedPRId,
    isConnected,
    selectPR,
    refresh,
  } = useAzureDevOpsPRs(projectId, { stateFilter });

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t('notConnected.title')}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
          {error || t('notConnected.description')}
        </p>
        {onOpenSettings && (
          <Button variant="outline" onClick={onOpenSettings} className="gap-2">
            <SettingsIcon className="h-4 w-4" />
            {t('notConnected.openSettings')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* List Panel */}
      <div className="w-1/2 border-r border-border flex flex-col">
        <div className="flex items-center gap-1 p-3 border-b border-border">
          {(['active', 'abandoned', 'completed', 'all'] as const).map((state) => (
            <Button
              key={state}
              size="sm"
              variant={stateFilter === state ? 'default' : 'outline'}
              onClick={() => setStateFilter(state)}
            >
              {t(
                `mergeRequests.filters.${
                  state === 'active' ? 'opened' : state === 'abandoned' ? 'closed' : state === 'completed' ? 'merged' : 'all'
                }`
              )}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={refresh} disabled={isLoading} className="ml-auto">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {error ? (
          <div className="p-4 bg-destructive/10 border-b border-destructive/30">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : pullRequests.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {t('empty.noMatch')}
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {pullRequests.map((pr) => (
                <button
                  key={pr.pullRequestId}
                  type="button"
                  onClick={() => selectPR(pr.pullRequestId)}
                  className={`w-full text-left p-3 rounded-md border transition-colors ${
                    selectedPRId === pr.pullRequestId
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:bg-accent'
                  }`}
                >
                  <div className="text-xs text-muted-foreground mb-1">
                    !{pr.pullRequestId} · {pr.sourceBranch} → {pr.targetBranch}
                  </div>
                  <div className="text-sm font-medium line-clamp-2">{pr.title}</div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Detail Panel */}
      <div className="flex-1 flex flex-col">
        {selectedPR ? (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  !{selectedPR.pullRequestId} · {selectedPR.status}
                </div>
                <h2 className="text-lg font-semibold">{selectedPR.title}</h2>
              </div>
              {selectedPR.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {selectedPR.description}
                </p>
              )}
              <div className="text-sm text-muted-foreground">
                {selectedPR.sourceBranch} → {selectedPR.targetBranch}
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={selectedPR.webUrl} target="_blank" rel="noreferrer">
                  {t('detail.viewTask')}
                </a>
              </Button>
            </div>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {t('mergeRequests.selectMR')}
          </div>
        )}
      </div>
    </div>
  );
}
