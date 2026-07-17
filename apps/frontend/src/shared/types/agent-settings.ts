/**
 * Provider-agnostic agent settings contract.
 *
 * This module defines the canonical, versioned data model shared by
 * Agent Settings (application defaults) and task metadata (per-task
 * snapshots). It is provider-agnostic: Claude, Codex, and any future
 * provider are described through a capability-driven registry rather
 * than hardcoded branches in shared UI/persistence code.
 *
 * See: .auto-claude/specs/010-provider-agnostic-agent-settings/spec.md
 */

import type { AgentProvider } from './task';

/** Pipeline phases every provider must be able to configure independently. */
export type AgentPhase = 'spec' | 'planning' | 'coding' | 'qa';

/** How a provider's "account" concept is presented and handled. */
export type ProviderAccountMode =
  | 'managed'         // Account/auth rotation is handled automatically (e.g. Claude profile rotation)
  | 'user-selectable' // User must pick from a list of configured accounts/profiles (e.g. Codex OpenAI profiles)
  | 'none';           // Provider has no account concept

/** Where a provider's available models come from. */
export type ProviderModelSource =
  | 'static'  // Fixed catalog known ahead of time
  | 'runtime'; // Discovered at runtime, with a static fallback catalog

/** A single selectable model option for a provider. */
export interface ProviderModelOption {
  id: string;
  label: string;
  description?: string;
}

/** A single selectable reasoning/thinking option for a provider. */
export interface ProviderReasoningOption {
  value: string;
  label: string;
  description?: string;
}

/** Model + reasoning selection for one pipeline phase. */
export interface ProviderPhaseSelection {
  model: string;
  reasoning: string;
}

/** Per-phase model/reasoning selections, keyed by AgentPhase. */
export type ProviderPhaseSelectionMap = Record<AgentPhase, ProviderPhaseSelection>;

/** A named, reusable bundle of per-phase selections for a provider. */
export interface ProviderPreset {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  phases: ProviderPhaseSelectionMap;
}

/** Optional capabilities a provider may support. */
export interface ProviderCapabilities {
  /** Provider supports Fast Mode (higher-cost, faster output). */
  fastMode?: boolean;
  /** Provider supports adaptive/extended reasoning beyond fixed levels. */
  adaptiveReasoning?: boolean;
  /** Provider exposes named presets in the registry. */
  presets?: boolean;
  /** Provider models are discovered at runtime (in addition to modelSource). */
  runtimeModelDiscovery?: boolean;
}

/**
 * Capability-driven provider definition. Shared UI and persistence code
 * should read from this registry instead of branching on provider IDs.
 */
export interface ProviderDefinition {
  id: AgentProvider;
  label: string;
  description: string;
  accountMode: ProviderAccountMode;
  accountLabel: string;
  modelLabel: string;
  modelSource: ProviderModelSource;
  /** Static model catalog. Used directly for 'static' sources, or as a fallback for 'runtime' sources. */
  models: ProviderModelOption[];
  reasoningLabel: string;
  reasoningOptions: ProviderReasoningOption[];
  presets?: ProviderPreset[];
  /** Default model/reasoning selection for every phase. */
  phaseDefaults: ProviderPhaseSelectionMap;
  capabilities: ProviderCapabilities;
}

/** Per-provider persisted configuration (application defaults or task snapshot payload). */
export interface ProviderAgentSettings {
  accountId?: string;
  presetId?: string;
  phases: ProviderPhaseSelectionMap;
}

/**
 * Canonical, versioned application-wide agent settings.
 * Persisted at `AppSettings.agentSettings`.
 */
export interface AgentSettingsState {
  version: 1;
  selectedProvider: AgentProvider;
  providers: Partial<Record<AgentProvider, ProviderAgentSettings>>;
}

/**
 * Canonical, versioned per-task agent configuration snapshot.
 * Persisted at `TaskMetadata.agentConfig`. Authoritative for new/edited
 * tasks; legacy per-provider fields remain readable as fallback only.
 */
export interface TaskAgentConfig {
  version: 1;
  provider: AgentProvider;
  accountId?: string;
  presetId?: string;
  phases: ProviderPhaseSelectionMap;
}
