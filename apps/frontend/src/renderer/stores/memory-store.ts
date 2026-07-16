import { create } from 'zustand';
import type {
  MemoryEntity,
  MemoryRelationship,
  MemoryTimelineEntry,
  MemoryEpisode,
  MemoryKind
} from '../../shared/types';

// Which tab of the memory browser is active.
export type MemoryTab = 'entities' | 'relationships' | 'timeline';

// Payload accepted when editing a memory entry.
export interface MemoryUpdatePayload {
  content?: string;
  summary?: string;
  name?: string;
}

interface MemoryState {
  // Data
  entities: MemoryEntity[];
  relationships: MemoryRelationship[];
  episodes: MemoryTimelineEntry[];
  timeline: MemoryTimelineEntry[];
  searchResults: MemoryEpisode[];
  searchQuery: string;
  selectedEntry: MemoryEpisode | MemoryEntity | null;
  activeTab: MemoryTab;
  isLoading: boolean;
  error: string | null;
  memoryEnabled: boolean;

  // Setters
  setEntities: (entities: MemoryEntity[]) => void;
  setRelationships: (relationships: MemoryRelationship[]) => void;
  setEpisodes: (episodes: MemoryTimelineEntry[]) => void;
  setTimeline: (timeline: MemoryTimelineEntry[]) => void;
  setSearchResults: (results: MemoryEpisode[]) => void;
  setSearchQuery: (query: string) => void;
  setSelectedEntry: (entry: MemoryEpisode | MemoryEntity | null) => void;
  setActiveTab: (tab: MemoryTab) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMemoryEnabled: (enabled: boolean) => void;
  clearAll: () => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  // Data
  entities: [],
  relationships: [],
  episodes: [],
  timeline: [],
  searchResults: [],
  searchQuery: '',
  selectedEntry: null,
  activeTab: 'timeline',
  isLoading: false,
  error: null,
  memoryEnabled: true,

  // Setters
  setEntities: (entities) => set({ entities }),
  setRelationships: (relationships) => set({ relationships }),
  setEpisodes: (episodes) => set({ episodes }),
  setTimeline: (timeline) => set({ timeline }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedEntry: (selectedEntry) => set({ selectedEntry }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setMemoryEnabled: (memoryEnabled) => set({ memoryEnabled }),
  clearAll: () =>
    set({
      entities: [],
      relationships: [],
      episodes: [],
      timeline: [],
      searchResults: [],
      searchQuery: '',
      selectedEntry: null,
      activeTab: 'timeline',
      isLoading: false,
      error: null,
      memoryEnabled: true
    })
}));

/**
 * Load knowledge-graph entities for a project.
 */
export async function loadEntities(projectId: string, limit?: number): Promise<void> {
  const store = useMemoryStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.browseMemoryEntities(projectId, limit);
    if (result.success && result.data) {
      store.setEntities(result.data);
    } else {
      store.setError(result.error || 'Failed to load entities');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Load entity-to-entity relationships for a project.
 */
export async function loadRelationships(projectId: string, limit?: number): Promise<void> {
  const store = useMemoryStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getMemoryRelationships(projectId, limit);
    if (result.success && result.data) {
      store.setRelationships(result.data);
    } else {
      store.setError(result.error || 'Failed to load relationships');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Load recent episodes for a project.
 */
export async function loadEpisodes(projectId: string, limit?: number): Promise<void> {
  const store = useMemoryStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.browseMemoryEpisodes(projectId, limit);
    if (result.success && result.data) {
      store.setEpisodes(result.data);
    } else {
      store.setError(result.error || 'Failed to load episodes');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Load the per-project insight timeline.
 */
export async function loadTimeline(projectId: string, limit?: number): Promise<void> {
  const store = useMemoryStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.getMemoryTimeline(projectId, limit);
    if (result.success && result.data) {
      store.setTimeline(result.data);
    } else {
      store.setError(result.error || 'Failed to load timeline');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Search memory (scoped to the project) with a semantic query.
 */
export async function searchMemory(
  projectId: string,
  query: string,
  limit?: number
): Promise<void> {
  const store = useMemoryStore.getState();
  store.setSearchQuery(query);

  if (!query.trim()) {
    store.setSearchResults([]);
    return;
  }

  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.searchMemory(projectId, query, limit);
    if (result.success && result.data) {
      store.setSearchResults(result.data);
    } else {
      store.setSearchResults([]);
      store.setError(result.error || 'Failed to search memory');
    }
  } catch (error) {
    store.setSearchResults([]);
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Delete a memory entry, then refresh the affected list.
 */
export async function deleteEntry(
  projectId: string,
  uuid: string,
  kind: MemoryKind
): Promise<boolean> {
  const store = useMemoryStore.getState();
  let succeeded = false;
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.deleteMemoryEntry(projectId, uuid, kind);
    if (result.success && result.data) {
      store.setSelectedEntry(null);
      succeeded = true;
    } else {
      store.setError(result.error || 'Failed to delete entry');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }

  if (!succeeded) return false;

  // Refresh the affected list after the mutation completes.
  if (kind === 'entity') {
    await loadEntities(projectId);
  } else {
    await loadEpisodes(projectId);
    await loadTimeline(projectId);
  }
  return true;
}

/**
 * Update a memory entry, then refresh the affected list.
 */
export async function updateEntry(
  projectId: string,
  uuid: string,
  kind: MemoryKind,
  payload: MemoryUpdatePayload
): Promise<boolean> {
  const store = useMemoryStore.getState();
  let succeeded = false;
  store.setLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.updateMemoryEntry(projectId, uuid, kind, payload);
    if (result.success && result.data) {
      store.setSelectedEntry(null);
      succeeded = true;
    } else {
      store.setError(result.error || 'Failed to update entry');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setLoading(false);
  }

  if (!succeeded) return false;

  // Refresh the affected list after the mutation completes.
  if (kind === 'entity') {
    await loadEntities(projectId);
  } else {
    await loadEpisodes(projectId);
    await loadTimeline(projectId);
  }
  return true;
}
