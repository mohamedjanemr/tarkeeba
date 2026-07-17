import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, Settings as SettingsIcon, RefreshCw, Search } from 'lucide-react';
import { useProjectStore } from '../../stores/project-store';
import { useAzureDevOpsIssues } from './hooks/useAzureDevOpsIssues';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import type { AzureDevOpsWorkItem } from '../../../shared/types';

interface AzureDevOpsIssuesProps {
  onOpenSettings?: () => void;
  onNavigateToTask?: (taskId: string) => void;
}

export function AzureDevOpsIssues({ onOpenSettings }: AzureDevOpsIssuesProps) {
  const { t } = useTranslation('azure-devops');
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const {
    syncStatus,
    isLoading,
    error,
    selectedWorkItemId,
    selectedWorkItem,
    filterState,
    selectWorkItem,
    getFilteredWorkItems,
    getOpenWorkItemsCount,
    handleRefresh,
    handleFilterChange,
  } = useAzureDevOpsIssues(selectedProject?.id);

  const [searchQuery, setSearchQuery] = useState('');

  const filteredWorkItems = useMemo(() => {
    const items = getFilteredWorkItems();
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item: AzureDevOpsWorkItem) =>
        item.title.toLowerCase().includes(query) ||
        String(item.id).includes(query)
    );
  }, [getFilteredWorkItems, searchQuery]);

  if (!syncStatus?.connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t('notConnected.title')}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
          {syncStatus?.error || t('notConnected.description')}
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
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('header.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {(['open', 'closed', 'all'] as const).map((state) => (
            <Button
              key={state}
              size="sm"
              variant={filterState === state ? 'default' : 'outline'}
              onClick={() => handleFilterChange(state)}
            >
              {t(`filters.${state === 'open' ? 'opened' : state}`)}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      <div className="px-3 py-1 text-xs text-muted-foreground">
        {getOpenWorkItemsCount()} {t('header.open')}
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* List */}
        <div className="w-1/2 border-r border-border flex flex-col">
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
          ) : filteredWorkItems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {t('empty.noMatch')}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {filteredWorkItems.map((item: AzureDevOpsWorkItem) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectWorkItem(item.id)}
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      selectedWorkItemId === item.id
                        ? 'border-primary bg-primary/5'
                        : 'border-transparent hover:bg-accent'
                    }`}
                  >
                    <div className="text-xs text-muted-foreground mb-1">
                      #{item.id} · {item.workItemType} · {item.state}
                    </div>
                    <div className="text-sm font-medium line-clamp-2">{item.title}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Detail */}
        <div className="w-1/2 flex flex-col">
          {selectedWorkItem ? (
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    #{selectedWorkItem.id} · {selectedWorkItem.workItemType}
                  </div>
                  <h2 className="text-lg font-semibold">{selectedWorkItem.title}</h2>
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-1">{t('detail.description')}</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedWorkItem.description || t('detail.noDescription')}
                  </p>
                </div>
                {selectedWorkItem.assignedTo && (
                  <div>
                    <h3 className="text-sm font-medium mb-1">{t('detail.assignees')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkItem.assignedTo.displayName}
                    </p>
                  </div>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href={selectedWorkItem.webUrl} target="_blank" rel="noreferrer">
                    {t('detail.viewTask')}
                  </a>
                </Button>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {t('empty.selectIssue')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
