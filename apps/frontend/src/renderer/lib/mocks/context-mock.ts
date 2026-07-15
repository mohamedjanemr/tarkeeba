/**
 * Mock implementation for context and memory operations
 */

export const contextMock = {
  getProjectContext: async () => ({
    success: true,
    data: {
      projectIndex: null,
      memoryStatus: null,
      memoryState: null,
      recentMemories: [],
      isLoading: false
    }
  }),

  refreshProjectIndex: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getMemoryStatus: async () => ({
    success: true,
    data: {
      enabled: false,
      available: false,
      reason: 'Browser mock environment'
    }
  }),

  searchMemories: async () => ({
    success: true,
    data: []
  }),

  getRecentMemories: async () => ({
    success: true,
    data: []
  }),

  // Memory Browser (per-project insight timeline)
  getMemoryEnabled: async () => ({
    success: true,
    data: true
  }),

  browseMemoryEntities: async () => ({
    success: true,
    data: []
  }),

  browseMemoryEpisodes: async () => ({
    success: true,
    data: []
  }),

  getMemoryRelationships: async () => ({
    success: true,
    data: []
  }),

  searchMemory: async () => ({
    success: true,
    data: []
  }),

  getMemoryTimeline: async () => ({
    success: true,
    data: []
  }),

  deleteMemoryEntry: async () => ({
    success: true,
    data: { deleted: false }
  }),

  updateMemoryEntry: async () => ({
    success: true,
    data: {}
  })
};
