/**
 * Memory browser types
 *
 * Types for the per-project memory browser and insight timeline. These extend
 * the base MemoryEpisode from project.ts with browser-oriented shapes for
 * entities, relationships, and timeline buckets.
 */

import type { MemoryEpisode } from './project';

// Discriminates the two kinds of memory records surfaced by the browser.
export type MemoryKind = 'episodic' | 'entity';

// A node in the knowledge graph (entity/summary extracted from episodes).
export interface MemoryEntity {
  id: string;
  name: string;
  type: string;
  summary: string;
  timestamp: string;
  groupId?: string;
}

// An edge in the knowledge graph connecting two entities via a stated fact.
export interface MemoryRelationship {
  id: string;
  source: string;
  target: string;
  fact: string;
  timestamp: string;
}

// A single entry rendered on the insight timeline. Reuses the base episode
// shape and adds optional grouping/bucketing metadata for the browser.
export interface MemoryTimelineEntry extends MemoryEpisode {
  group_id?: string;
  // Date bucket key (e.g. an ISO day) used to group entries on the timeline.
  date?: string;
}

// Result payload returned when browsing memory for a project.
export interface MemoryBrowseResult {
  kind: MemoryKind;
  episodes: MemoryTimelineEntry[];
  entities: MemoryEntity[];
  relationships: MemoryRelationship[];
  groupId?: string;
  total: number;
}
