/**
 * Capability-driven provider registry for Agent Settings.
 *
 * Shared UI and persistence code should read provider labels, account
 * behavior, model sources, reasoning controls, presets, capabilities, and
 * per-phase defaults from this registry instead of branching directly on
 * `provider === 'codex'` (or `'claude'`) throughout the codebase.
 *
 * See: .auto-claude/specs/010-provider-agnostic-agent-settings/spec.md
 */

import type { AgentProvider } from '../types/task';
import type {
  AgentPhase,
  ProviderAgentSettings,
  ProviderDefinition,
  ProviderPhaseSelection,
  ProviderPhaseSelectionMap,
  ProviderPreset,
  ProviderReasoningOption
} from '../types/agent-settings';
import {
  AVAILABLE_MODELS,
  THINKING_LEVELS,
  DEFAULT_AGENT_PROFILES,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
  CODEX_MODEL_CATALOG,
  CODEX_REASONING_LEVELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT
} from '../constants/models';

/** Ordered list of every pipeline phase a provider must configure. */
export const AGENT_PHASES: readonly AgentPhase[] = ['spec', 'planning', 'coding', 'qa'] as const;

function buildPhaseSelectionMap(
  models: Record<AgentPhase, string>,
  reasoning: Record<AgentPhase, string>
): ProviderPhaseSelectionMap {
  return {
    spec: { model: models.spec, reasoning: reasoning.spec },
    planning: { model: models.planning, reasoning: reasoning.planning },
    coding: { model: models.coding, reasoning: reasoning.coding },
    qa: { model: models.qa, reasoning: reasoning.qa }
  };
}

// ============================================
// Claude provider definition
// ============================================

const CLAUDE_PRESETS: ProviderPreset[] = DEFAULT_AGENT_PROFILES.map((profile) => ({
  id: profile.id,
  name: profile.name,
  description: profile.description,
  icon: profile.icon,
  phases: buildPhaseSelectionMap(
    profile.phaseModels ?? DEFAULT_PHASE_MODELS,
    profile.phaseThinking ?? DEFAULT_PHASE_THINKING
  )
}));

const CLAUDE_PHASE_DEFAULTS: ProviderPhaseSelectionMap = buildPhaseSelectionMap(
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING
);

export const CLAUDE_PROVIDER_DEFINITION: ProviderDefinition = {
  id: 'claude',
  label: 'Claude Code',
  description: 'Anthropic Claude via OAuth subscription or API profile, with managed account rotation.',
  accountMode: 'managed',
  accountLabel: 'Claude account',
  modelLabel: 'Model',
  modelSource: 'static',
  models: AVAILABLE_MODELS.map((model) => ({ id: model.value, label: model.label })),
  reasoningLabel: 'Thinking level',
  reasoningOptions: THINKING_LEVELS.map((level) => ({
    value: level.value,
    label: level.label,
    description: level.description
  })),
  presets: CLAUDE_PRESETS,
  phaseDefaults: CLAUDE_PHASE_DEFAULTS,
  capabilities: {
    fastMode: true,
    adaptiveReasoning: true,
    presets: true,
    runtimeModelDiscovery: false
  }
};

// ============================================
// Codex provider definition
// ============================================

const CODEX_PHASE_DEFAULTS: ProviderPhaseSelectionMap = buildPhaseSelectionMap(
  { spec: DEFAULT_CODEX_MODEL, planning: DEFAULT_CODEX_MODEL, coding: DEFAULT_CODEX_MODEL, qa: DEFAULT_CODEX_MODEL },
  {
    spec: DEFAULT_CODEX_REASONING_EFFORT,
    planning: DEFAULT_CODEX_REASONING_EFFORT,
    coding: DEFAULT_CODEX_REASONING_EFFORT,
    qa: DEFAULT_CODEX_REASONING_EFFORT
  }
);

export const CODEX_PROVIDER_DEFINITION: ProviderDefinition = {
  id: 'codex',
  label: 'OpenAI Codex',
  description: 'OpenAI Codex CLI with a user-selected account and per-phase model/reasoning effort.',
  accountMode: 'user-selectable',
  accountLabel: 'OpenAI account',
  modelLabel: 'Codex model',
  modelSource: 'runtime',
  models: CODEX_MODEL_CATALOG.map((model) => ({ id: model.id, label: model.label, description: model.description })),
  reasoningLabel: 'Reasoning effort',
  reasoningOptions: CODEX_REASONING_LEVELS.map((level) => ({
    value: level.value,
    label: level.label,
    description: level.description
  })),
  phaseDefaults: CODEX_PHASE_DEFAULTS,
  capabilities: {
    fastMode: false,
    adaptiveReasoning: false,
    presets: false,
    runtimeModelDiscovery: true
  }
};

/** Capability-driven registry keyed by provider ID. */
export const AGENT_PROVIDER_REGISTRY: Record<AgentProvider, ProviderDefinition> = {
  claude: CLAUDE_PROVIDER_DEFINITION,
  codex: CODEX_PROVIDER_DEFINITION
};

/** Ordered list of every registered provider definition. */
export const AGENT_PROVIDERS: readonly ProviderDefinition[] = [
  CLAUDE_PROVIDER_DEFINITION,
  CODEX_PROVIDER_DEFINITION
];

// ============================================
// Lookup helpers
// ============================================

/** Look up a provider's registry definition. Falls back to Claude for unknown/missing IDs. */
export function getProviderDefinition(provider: AgentProvider | undefined | null): ProviderDefinition {
  if (provider && AGENT_PROVIDER_REGISTRY[provider]) return AGENT_PROVIDER_REGISTRY[provider];
  return CLAUDE_PROVIDER_DEFINITION;
}

/** Find a named preset for a provider, or undefined if the provider has none or the ID is unknown. */
export function getProviderPreset(provider: AgentProvider, presetId: string | undefined): ProviderPreset | undefined {
  if (!presetId) return undefined;
  const definition = getProviderDefinition(provider);
  return definition.presets?.find((preset) => preset.id === presetId);
}

/** Whether a model ID appears in a provider's known catalog (static or fallback). */
export function isKnownProviderModel(provider: AgentProvider, modelId: string | undefined): boolean {
  if (!modelId) return false;
  const definition = getProviderDefinition(provider);
  return definition.models.some((model) => model.id === modelId);
}

/** Whether a reasoning value is one of the provider's selectable options. */
export function isValidProviderReasoning(provider: AgentProvider, reasoning: string | undefined): boolean {
  if (!reasoning) return false;
  const definition = getProviderDefinition(provider);
  return definition.reasoningOptions.some((option: ProviderReasoningOption) => option.value === reasoning);
}

// ============================================
// Normalization helpers
// ============================================

/**
 * Normalize a single phase's model/reasoning selection against a provider's
 * defaults. Unknown/saved models are preserved verbatim (never silently
 * replaced); invalid reasoning values fall back to the provider default for
 * that phase.
 */
export function normalizeProviderPhaseSelection(
  provider: AgentProvider,
  phase: AgentPhase,
  selection: Partial<ProviderPhaseSelection> | undefined
): ProviderPhaseSelection {
  const definition = getProviderDefinition(provider);
  const defaults = definition.phaseDefaults[phase];
  const model = selection?.model?.trim() ? selection.model.trim() : defaults.model;
  const reasoning = isValidProviderReasoning(provider, selection?.reasoning)
    ? (selection?.reasoning as string)
    : defaults.reasoning;
  return { model, reasoning };
}

/**
 * Normalize a full (possibly partial/missing) per-phase map against a
 * provider's defaults, filling in every phase the provider must configure.
 */
export function normalizeProviderPhaseMap(
  provider: AgentProvider,
  phases: Partial<Record<AgentPhase, Partial<ProviderPhaseSelection>>> | undefined
): ProviderPhaseSelectionMap {
  const result = {} as ProviderPhaseSelectionMap;
  for (const phase of AGENT_PHASES) {
    result[phase] = normalizeProviderPhaseSelection(provider, phase, phases?.[phase]);
  }
  return result;
}

/** A loosely-typed, possibly incomplete `ProviderAgentSettings` payload (e.g. from disk or a task draft). */
export type PartialProviderAgentSettings = {
  accountId?: string;
  presetId?: string;
  phases?: Partial<Record<AgentPhase, Partial<ProviderPhaseSelection>>>;
};

/**
 * Normalize a persisted/partial `ProviderAgentSettings` payload against the
 * provider's registry defaults. Used for both application settings migration
 * and task metadata resolution.
 */
export function normalizeProviderAgentSettings(
  provider: AgentProvider,
  settings: PartialProviderAgentSettings | undefined
): ProviderAgentSettings {
  const definition = getProviderDefinition(provider);
  const presetId = settings?.presetId && definition.presets?.some((preset) => preset.id === settings.presetId)
    ? settings.presetId
    : undefined;
  return {
    accountId: settings?.accountId,
    presetId,
    phases: normalizeProviderPhaseMap(provider, settings?.phases)
  };
}
