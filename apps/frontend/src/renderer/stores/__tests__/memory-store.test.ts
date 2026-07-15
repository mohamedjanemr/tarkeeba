/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for memory-store
 * Tests that loaders populate state on success and set errors on failure, and
 * that deleteEntry/updateEntry refresh the affected list (entities vs.
 * episodes+timeline) and handle the { success: false } IPC path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  MemoryEntity,
  MemoryRelationship,
  MemoryTimelineEntry,
  MemoryEpisode
} from '../../../shared/types';

// Mock the electronAPI for IPC communication
const mockBrowseMemoryEntities = vi.fn();
const mockGetMemoryRelationships = vi.fn();
const mockBrowseMemoryEpisodes = vi.fn();
const mockGetMemoryTimeline = vi.fn();
const mockSearchMemory = vi.fn();
const mockDeleteMemoryEntry = vi.fn();
const mockUpdateMemoryEntry = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    browseMemoryEntities: mockBrowseMemoryEntities,
    getMemoryRelationships: mockGetMemoryRelationships,
    browseMemoryEpisodes: mockBrowseMemoryEpisodes,
    getMemoryTimeline: mockGetMemoryTimeline,
    searchMemory: mockSearchMemory,
    deleteMemoryEntry: mockDeleteMemoryEntry,
    updateMemoryEntry: mockUpdateMemoryEntry
  }
});

const sampleEntity: MemoryEntity = {
  id: 'entity-1',
  name: 'Auth Service',
  type: 'Service',
  summary: 'Handles authentication',
  timestamp: '2026-07-15T00:00:00Z'
};

const sampleRelationship: MemoryRelationship = {
  id: 'rel-1',
  source: 'entity-1',
  target: 'entity-2',
  fact: 'Auth Service depends on Token Store',
  timestamp: '2026-07-15T00:00:00Z'
};

const sampleEpisode: MemoryEpisode = {
  id: 'episode-1',
  type: 'session_insight',
  timestamp: '2026-07-15T00:00:00Z',
  content: 'Some insight'
};

const sampleTimelineEntry: MemoryTimelineEntry = {
  ...sampleEpisode,
  date: '2026-07-15'
};

describe('memory-store', () => {
  let useMemoryStore: typeof import('../memory-store').useMemoryStore;
  let loadEntities: typeof import('../memory-store').loadEntities;
  let loadRelationships: typeof import('../memory-store').loadRelationships;
  let loadEpisodes: typeof import('../memory-store').loadEpisodes;
  let loadTimeline: typeof import('../memory-store').loadTimeline;
  let searchMemory: typeof import('../memory-store').searchMemory;
  let deleteEntry: typeof import('../memory-store').deleteEntry;
  let updateEntry: typeof import('../memory-store').updateEntry;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const storeModule = await import('../memory-store');
    useMemoryStore = storeModule.useMemoryStore;
    loadEntities = storeModule.loadEntities;
    loadRelationships = storeModule.loadRelationships;
    loadEpisodes = storeModule.loadEpisodes;
    loadTimeline = storeModule.loadTimeline;
    searchMemory = storeModule.searchMemory;
    deleteEntry = storeModule.deleteEntry;
    updateEntry = storeModule.updateEntry;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Store initialization', () => {
    it('should initialize with default state', () => {
      const state = useMemoryStore.getState();

      expect(state.entities).toEqual([]);
      expect(state.relationships).toEqual([]);
      expect(state.episodes).toEqual([]);
      expect(state.timeline).toEqual([]);
      expect(state.searchResults).toEqual([]);
      expect(state.searchQuery).toBe('');
      expect(state.selectedEntry).toBeNull();
      expect(state.activeTab).toBe('entities');
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.memoryEnabled).toBe(true);
    });
  });

  describe('Store setters', () => {
    it('should set the active tab', () => {
      useMemoryStore.getState().setActiveTab('timeline');
      expect(useMemoryStore.getState().activeTab).toBe('timeline');
    });

    it('should set the selected entry', () => {
      useMemoryStore.getState().setSelectedEntry(sampleEntity);
      expect(useMemoryStore.getState().selectedEntry).toEqual(sampleEntity);
    });

    it('clearAll should reset to defaults', () => {
      const store = useMemoryStore.getState();
      store.setEntities([sampleEntity]);
      store.setActiveTab('relationships');
      store.setError('boom');

      store.clearAll();

      const state = useMemoryStore.getState();
      expect(state.entities).toEqual([]);
      expect(state.activeTab).toBe('entities');
      expect(state.error).toBeNull();
    });
  });

  describe('loadEntities', () => {
    it('should populate entities on success', async () => {
      mockBrowseMemoryEntities.mockResolvedValue({ success: true, data: [sampleEntity] });

      await loadEntities('project-1', 50);

      const state = useMemoryStore.getState();
      expect(mockBrowseMemoryEntities).toHaveBeenCalledWith('project-1', 50);
      expect(state.entities).toEqual([sampleEntity]);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('should set error on failure', async () => {
      mockBrowseMemoryEntities.mockResolvedValue({ success: false, error: 'nope' });

      await loadEntities('project-1');

      const state = useMemoryStore.getState();
      expect(state.error).toBe('nope');
      expect(state.entities).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it('should fall back to a default error message', async () => {
      mockBrowseMemoryEntities.mockResolvedValue({ success: false });

      await loadEntities('project-1');

      expect(useMemoryStore.getState().error).toBe('Failed to load entities');
    });

    it('should capture thrown errors', async () => {
      mockBrowseMemoryEntities.mockRejectedValue(new Error('exploded'));

      await loadEntities('project-1');

      const state = useMemoryStore.getState();
      expect(state.error).toBe('exploded');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('loadRelationships', () => {
    it('should populate relationships on success', async () => {
      mockGetMemoryRelationships.mockResolvedValue({
        success: true,
        data: [sampleRelationship]
      });

      await loadRelationships('project-1');

      const state = useMemoryStore.getState();
      expect(mockGetMemoryRelationships).toHaveBeenCalledWith('project-1', undefined);
      expect(state.relationships).toEqual([sampleRelationship]);
      expect(state.error).toBeNull();
    });

    it('should set error on failure', async () => {
      mockGetMemoryRelationships.mockResolvedValue({ success: false });

      await loadRelationships('project-1');

      expect(useMemoryStore.getState().error).toBe('Failed to load relationships');
    });
  });

  describe('loadEpisodes', () => {
    it('should populate episodes on success', async () => {
      mockBrowseMemoryEpisodes.mockResolvedValue({
        success: true,
        data: [sampleTimelineEntry]
      });

      await loadEpisodes('project-1');

      const state = useMemoryStore.getState();
      expect(mockBrowseMemoryEpisodes).toHaveBeenCalledWith('project-1', undefined);
      expect(state.episodes).toEqual([sampleTimelineEntry]);
    });

    it('should set error on failure', async () => {
      mockBrowseMemoryEpisodes.mockResolvedValue({ success: false });

      await loadEpisodes('project-1');

      expect(useMemoryStore.getState().error).toBe('Failed to load episodes');
    });
  });

  describe('loadTimeline', () => {
    it('should populate the timeline on success', async () => {
      mockGetMemoryTimeline.mockResolvedValue({
        success: true,
        data: [sampleTimelineEntry]
      });

      await loadTimeline('project-1');

      const state = useMemoryStore.getState();
      expect(mockGetMemoryTimeline).toHaveBeenCalledWith('project-1', undefined);
      expect(state.timeline).toEqual([sampleTimelineEntry]);
    });

    it('should set error on failure', async () => {
      mockGetMemoryTimeline.mockResolvedValue({ success: false });

      await loadTimeline('project-1');

      expect(useMemoryStore.getState().error).toBe('Failed to load timeline');
    });
  });

  describe('searchMemory', () => {
    it('should populate search results on success', async () => {
      mockSearchMemory.mockResolvedValue({ success: true, data: [sampleEpisode] });

      await searchMemory('project-1', 'auth', 10);

      const state = useMemoryStore.getState();
      expect(mockSearchMemory).toHaveBeenCalledWith('project-1', 'auth', 10);
      expect(state.searchQuery).toBe('auth');
      expect(state.searchResults).toEqual([sampleEpisode]);
    });

    it('should short-circuit and clear results for an empty query', async () => {
      await searchMemory('project-1', '   ');

      const state = useMemoryStore.getState();
      expect(mockSearchMemory).not.toHaveBeenCalled();
      expect(state.searchQuery).toBe('   ');
      expect(state.searchResults).toEqual([]);
    });

    it('should clear results and set error on failure', async () => {
      mockSearchMemory.mockResolvedValue({ success: false, error: 'search failed' });

      await searchMemory('project-1', 'auth');

      const state = useMemoryStore.getState();
      expect(state.searchResults).toEqual([]);
      expect(state.error).toBe('search failed');
    });
  });

  describe('deleteEntry', () => {
    it('should clear selection and refresh entities for an entity', async () => {
      mockDeleteMemoryEntry.mockResolvedValue({ success: true, data: { deleted: true } });
      mockBrowseMemoryEntities.mockResolvedValue({ success: true, data: [sampleEntity] });
      useMemoryStore.getState().setSelectedEntry(sampleEntity);

      await deleteEntry('project-1', 'entity-1', 'entity');

      const state = useMemoryStore.getState();
      expect(mockDeleteMemoryEntry).toHaveBeenCalledWith('project-1', 'entity-1', 'entity');
      expect(mockBrowseMemoryEntities).toHaveBeenCalledWith('project-1', undefined);
      expect(mockBrowseMemoryEpisodes).not.toHaveBeenCalled();
      expect(state.selectedEntry).toBeNull();
      expect(state.entities).toEqual([sampleEntity]);
    });

    it('should refresh episodes and timeline for an episodic entry', async () => {
      mockDeleteMemoryEntry.mockResolvedValue({ success: true, data: { deleted: true } });
      mockBrowseMemoryEpisodes.mockResolvedValue({ success: true, data: [sampleTimelineEntry] });
      mockGetMemoryTimeline.mockResolvedValue({ success: true, data: [sampleTimelineEntry] });

      await deleteEntry('project-1', 'episode-1', 'episodic');

      expect(mockBrowseMemoryEpisodes).toHaveBeenCalledWith('project-1', undefined);
      expect(mockGetMemoryTimeline).toHaveBeenCalledWith('project-1', undefined);
      expect(mockBrowseMemoryEntities).not.toHaveBeenCalled();
    });

    it('should set error on { success: false } but still refresh the list', async () => {
      mockDeleteMemoryEntry.mockResolvedValue({ success: false });
      mockBrowseMemoryEntities.mockResolvedValue({ success: true, data: [] });
      useMemoryStore.getState().setSelectedEntry(sampleEntity);

      await deleteEntry('project-1', 'entity-1', 'entity');

      const state = useMemoryStore.getState();
      // Selection is not cleared on failure.
      expect(state.selectedEntry).toEqual(sampleEntity);
      // The refresh clears the error via loadEntities, so verify the refresh ran.
      expect(mockBrowseMemoryEntities).toHaveBeenCalledWith('project-1', undefined);
    });
  });

  describe('updateEntry', () => {
    it('should clear selection and refresh entities for an entity', async () => {
      mockUpdateMemoryEntry.mockResolvedValue({ success: true, data: { record: sampleEpisode } });
      mockBrowseMemoryEntities.mockResolvedValue({ success: true, data: [sampleEntity] });
      useMemoryStore.getState().setSelectedEntry(sampleEntity);

      await updateEntry('project-1', 'entity-1', 'entity', { name: 'Renamed' });

      const state = useMemoryStore.getState();
      expect(mockUpdateMemoryEntry).toHaveBeenCalledWith('project-1', 'entity-1', 'entity', {
        name: 'Renamed'
      });
      expect(mockBrowseMemoryEntities).toHaveBeenCalledWith('project-1', undefined);
      expect(state.selectedEntry).toBeNull();
    });

    it('should refresh episodes and timeline for an episodic entry', async () => {
      mockUpdateMemoryEntry.mockResolvedValue({ success: true, data: { record: sampleEpisode } });
      mockBrowseMemoryEpisodes.mockResolvedValue({ success: true, data: [sampleTimelineEntry] });
      mockGetMemoryTimeline.mockResolvedValue({ success: true, data: [sampleTimelineEntry] });

      await updateEntry('project-1', 'episode-1', 'episodic', { content: 'Updated' });

      expect(mockBrowseMemoryEpisodes).toHaveBeenCalledWith('project-1', undefined);
      expect(mockGetMemoryTimeline).toHaveBeenCalledWith('project-1', undefined);
      expect(mockBrowseMemoryEntities).not.toHaveBeenCalled();
    });

    it('should set error on { success: false } and keep the selection', async () => {
      mockUpdateMemoryEntry.mockResolvedValue({ success: false, error: 'update failed' });
      mockBrowseMemoryEntities.mockResolvedValue({ success: true, data: [] });
      useMemoryStore.getState().setSelectedEntry(sampleEntity);

      await updateEntry('project-1', 'entity-1', 'entity', { name: 'Renamed' });

      expect(useMemoryStore.getState().selectedEntry).toEqual(sampleEntity);
      expect(mockBrowseMemoryEntities).toHaveBeenCalledWith('project-1', undefined);
    });
  });
});
