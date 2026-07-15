import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, GitBranch, History, Search, Brain, Loader2, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { MemoryCard } from '../context/MemoryCard';
import {
  useMemoryStore,
  loadEntities,
  loadRelationships,
  loadTimeline,
  searchMemory,
  type MemoryTab
} from '../../stores/memory-store';
import { MemoryEntityList } from './MemoryEntityList';
import { MemoryRelationshipList } from './MemoryRelationshipList';
import { InsightTimeline } from './InsightTimeline';
import { MemoryEntryDetail } from './MemoryEntryDetail';

interface MemoryBrowserProps {
  projectId: string;
}

/**
 * Per-project memory browser: entity / relationship / timeline tabs with a
 * scoped search bar and edit/prune controls. Shows a graceful empty state when
 * memory is disabled or no data is available.
 */
export function MemoryBrowser({ projectId }: MemoryBrowserProps) {
  const { t } = useTranslation('memory');

  const entities = useMemoryStore((s) => s.entities);
  const relationships = useMemoryStore((s) => s.relationships);
  const timeline = useMemoryStore((s) => s.timeline);
  const searchResults = useMemoryStore((s) => s.searchResults);
  const searchQuery = useMemoryStore((s) => s.searchQuery);
  const selectedEntry = useMemoryStore((s) => s.selectedEntry);
  const activeTab = useMemoryStore((s) => s.activeTab);
  const isLoading = useMemoryStore((s) => s.isLoading);
  const error = useMemoryStore((s) => s.error);
  const memoryEnabled = useMemoryStore((s) => s.memoryEnabled);
  const setActiveTab = useMemoryStore((s) => s.setActiveTab);
  const setSelectedEntry = useMemoryStore((s) => s.setSelectedEntry);
  const setSearchQuery = useMemoryStore((s) => s.setSearchQuery);
  const setMemoryEnabled = useMemoryStore((s) => s.setMemoryEnabled);

  const [localQuery, setLocalQuery] = useState('');

  // Resolve whether Graphiti memory is enabled for this project so the
  // disabled empty state renders when memory is off. Only load data when on.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    (async () => {
      const result = await window.electronAPI.getMemoryEnabled(projectId);
      const enabled = result.success ? (result.data ?? false) : false;
      if (cancelled) return;
      setMemoryEnabled(enabled);
      if (enabled) {
        loadEntities(projectId);
        loadRelationships(projectId);
        loadTimeline(projectId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, setMemoryEnabled]);

  const handleSearch = () => {
    if (localQuery.trim()) {
      searchMemory(projectId, localQuery);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setLocalQuery('');
    setSearchQuery('');
  };

  // Disabled state: memory feature is off for this project.
  if (!memoryEnabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="rounded-full bg-muted/50 p-4">
          <Brain className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{t('empty.disabled.title')}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t('empty.disabled.description')}</p>
      </div>
    );
  }

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header + search */}
      <div className="border-b border-border px-6 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Brain className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('search.placeholder')}
              className="pl-9"
            />
            {isSearching && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={t('search.clear')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button onClick={handleSearch} disabled={isLoading || !localQuery.trim()}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('search.button')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Search results take over the body while a query is active. */}
      {isSearching ? (
        <ScrollArea className="flex-1">
          <div className="space-y-3 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {t('search.results', { count: searchResults.length })}
              </h3>
              <Button variant="ghost" size="sm" onClick={clearSearch}>
                {t('search.clear')}
              </Button>
            </div>
            {searchResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('search.noResults')}</p>
            ) : (
              searchResults.map((memory) => <MemoryCard key={memory.id} memory={memory} />)
            )}
          </div>
        </ScrollArea>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as MemoryTab)}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="px-6 pt-4">
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="entities" className="gap-2">
                <Boxes className="h-4 w-4" />
                {t('tabs.entities')}
              </TabsTrigger>
              <TabsTrigger value="relationships" className="gap-2">
                <GitBranch className="h-4 w-4" />
                {t('tabs.relationships')}
              </TabsTrigger>
              <TabsTrigger value="timeline" className="gap-2">
                <History className="h-4 w-4" />
                {t('tabs.timeline')}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="entities" className={cn('m-0 flex-1 overflow-hidden')}>
            <ScrollArea className="h-full">
              <div className="p-6">
                <MemoryEntityList entities={entities} onSelect={setSelectedEntry} />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="relationships" className="m-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-6">
                <MemoryRelationshipList relationships={relationships} />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="timeline" className="m-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-6">
                <InsightTimeline entries={timeline} onSelect={setSelectedEntry} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      )}

      <MemoryEntryDetail
        projectId={projectId}
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </div>
  );
}
