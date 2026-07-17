/**
 * Model and agent profile constants
 * Claude models, thinking levels, memory backends, and agent profiles
 */

import type { AgentProfile, PhaseModelConfig, FeatureModelConfig, FeatureThinkingConfig } from '../types/settings';

// ============================================
// Available Models
// ============================================

export const AVAILABLE_MODELS = [
  { value: 'fable', label: 'Claude Fable 5' },
  { value: 'opus', label: 'Claude Opus 4.8' },
  { value: 'opus-4.8', label: 'Claude Opus 4.8 (Pinned)' },
  { value: 'opus-4.7', label: 'Claude Opus 4.7' },
  { value: 'opus-4.6', label: 'Claude Opus 4.6' },
  { value: 'opus-1m', label: 'Claude Opus 4.6 (1M)' },
  { value: 'opus-4.5', label: 'Claude Opus 4.5' },
  { value: 'sonnet', label: 'Claude Sonnet 5' },
  { value: 'sonnet-5', label: 'Claude Sonnet 5 (Pinned)' },
  { value: 'sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { value: 'sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'haiku', label: 'Claude Haiku 4.5' }
] as const;

// Maps model shorthand to actual Claude model IDs
// Values must match apps/backend/phase_config.py MODEL_ID_MAP
export const MODEL_ID_MAP: Record<string, string> = {
  fable: 'claude-fable-5',
  opus: 'claude-opus-4-8',
  'opus-4.8': 'claude-opus-4-8',
  'opus-4.7': 'claude-opus-4-7',
  'opus-4.6': 'claude-opus-4-6',
  'opus-1m': 'claude-opus-4-6',
  'opus-4.5': 'claude-opus-4-5-20251101',
  sonnet: 'claude-sonnet-5',
  'sonnet-5': 'claude-sonnet-5',
  'sonnet-4.6': 'claude-sonnet-4-6',
  'sonnet-4.5': 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001'
} as const;

// Maps thinking levels to budget tokens
export const THINKING_BUDGET_MAP: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 16384
} as const;

// ============================================
// Thinking Levels
// ============================================

// Thinking levels for Claude model (budget token allocation)
export const THINKING_LEVELS = [
  { value: 'low', label: 'Low', description: 'Brief consideration' },
  { value: 'medium', label: 'Medium', description: 'Moderate analysis' },
  { value: 'high', label: 'High', description: 'Deep thinking' }
] as const;

// ============================================
// Agent Profiles - Phase Configurations
// ============================================

// Phase configurations for each preset profile
// Each profile has its own default phase models and thinking levels

// Auto (Optimized) - Opus with optimized thinking per phase
export const AUTO_PHASE_MODELS: PhaseModelConfig = {
  spec: 'opus',
  planning: 'opus',
  coding: 'opus',
  qa: 'opus'
};

export const AUTO_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'high',   // Deep thinking for comprehensive spec creation
  planning: 'high',     // High thinking for planning complex features
  coding: 'low',        // Faster coding iterations
  qa: 'low'             // Efficient QA review
};

// Complex Tasks - Opus with high thinking across all phases
export const COMPLEX_PHASE_MODELS: PhaseModelConfig = {
  spec: 'opus',
  planning: 'opus',
  coding: 'opus',
  qa: 'opus'
};

export const COMPLEX_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'high',
  planning: 'high',
  coding: 'high',
  qa: 'high'
};

// Balanced - Sonnet with medium thinking across all phases
export const BALANCED_PHASE_MODELS: PhaseModelConfig = {
  spec: 'sonnet',
  planning: 'sonnet',
  coding: 'sonnet',
  qa: 'sonnet'
};

export const BALANCED_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'medium',
  planning: 'medium',
  coding: 'medium',
  qa: 'medium'
};

// Quick Edits - Haiku with low thinking across all phases
export const QUICK_PHASE_MODELS: PhaseModelConfig = {
  spec: 'haiku',
  planning: 'haiku',
  coding: 'haiku',
  qa: 'haiku'
};

export const QUICK_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'low',
  planning: 'low',
  coding: 'low',
  qa: 'low'
};

// Default phase configuration (used for fallback, matches 'Balanced' profile for cost-effectiveness)
export const DEFAULT_PHASE_MODELS: PhaseModelConfig = BALANCED_PHASE_MODELS;
export const DEFAULT_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = BALANCED_PHASE_THINKING;

// ============================================
// Feature Settings (Non-Pipeline Features)
// ============================================

// Default feature model configuration (for insights, ideation, roadmap, github, utility)
export const DEFAULT_FEATURE_MODELS: FeatureModelConfig = {
  insights: 'sonnet',     // Fast, responsive chat
  ideation: 'opus',       // Creative ideation benefits from Opus
  roadmap: 'opus',        // Strategic planning benefits from Opus
  githubIssues: 'opus',   // Issue triage and analysis benefits from Opus
  githubPrs: 'opus',      // PR review benefits from thorough Opus analysis
  utility: 'haiku'        // Fast utility operations (commit messages, merge resolution)
};

// Default feature thinking configuration
export const DEFAULT_FEATURE_THINKING: FeatureThinkingConfig = {
  insights: 'medium',     // Balanced thinking for chat
  ideation: 'high',       // Deep thinking for creative ideas
  roadmap: 'high',        // Strategic thinking for roadmap
  githubIssues: 'medium', // Moderate thinking for issue analysis
  githubPrs: 'medium',    // Moderate thinking for PR review
  utility: 'low'          // Fast thinking for utility operations
};

// Feature labels for UI display
export const FEATURE_LABELS: Record<keyof FeatureModelConfig, { label: string; description: string }> = {
  insights: { label: 'Insights Chat', description: 'Ask questions about your codebase' },
  ideation: { label: 'Ideation', description: 'Generate feature ideas and improvements' },
  roadmap: { label: 'Roadmap', description: 'Create strategic feature roadmaps' },
  githubIssues: { label: 'GitHub Issues', description: 'Automated issue triage and labeling' },
  githubPrs: { label: 'GitHub PR Review', description: 'AI-powered pull request reviews' },
  utility: { label: 'Utility', description: 'Commit messages and merge conflict resolution' }
};

// Default agent profiles for preset model/thinking configurations
// All profiles have per-phase configuration for full customization
export const DEFAULT_AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'auto',
    name: 'Auto (Optimized)',
    description: 'Uses Opus across all phases with optimized thinking levels',
    model: 'opus',
    thinkingLevel: 'high',
    icon: 'Sparkles',
    phaseModels: AUTO_PHASE_MODELS,
    phaseThinking: AUTO_PHASE_THINKING
  },
  {
    id: 'complex',
    name: 'Complex Tasks',
    description: 'For intricate, multi-step implementations requiring deep analysis',
    model: 'opus',
    thinkingLevel: 'high',
    icon: 'Brain',
    phaseModels: COMPLEX_PHASE_MODELS,
    phaseThinking: COMPLEX_PHASE_THINKING
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good balance of speed and quality for most tasks',
    model: 'sonnet',
    thinkingLevel: 'medium',
    icon: 'Scale',
    phaseModels: BALANCED_PHASE_MODELS,
    phaseThinking: BALANCED_PHASE_THINKING
  },
  {
    id: 'quick',
    name: 'Quick Edits',
    description: 'Fast iterations for simple changes and quick fixes',
    model: 'haiku',
    thinkingLevel: 'low',
    icon: 'Zap',
    phaseModels: QUICK_PHASE_MODELS,
    phaseThinking: QUICK_PHASE_THINKING
  }
];

// Models that support Fast Mode (same model, faster API routing, higher cost)
export const FAST_MODE_MODELS: readonly string[] = ['opus', 'opus-4.8', 'opus-4.7'] as const;

// Models that use adaptive thinking (Opus dynamically decides how much to think within the budget cap)
export const ADAPTIVE_THINKING_MODELS: readonly string[] = [
  'fable',
  'opus',
  'opus-4.8',
  'opus-4.7',
  'opus-4.6',
  'opus-1m',
  'sonnet',
  'sonnet-5',
  'sonnet-4.6'
] as const;

// Valid thinking levels for validation
export const VALID_THINKING_LEVELS = ['low', 'medium', 'high'] as const;

// Legacy thinking level mappings (must match backend phase_config.py LEGACY_THINKING_LEVEL_MAP)
export const LEGACY_THINKING_MAP: Record<string, string> = { ultrathink: 'high', none: 'low' } as const;

/** Sanitize a thinking level value, mapping legacy values to valid ones */
export function sanitizeThinkingLevel(val: string): string {
  if (VALID_THINKING_LEVELS.includes(val as typeof VALID_THINKING_LEVELS[number])) return val;
  return LEGACY_THINKING_MAP[val] ?? 'medium';
}

// Phase keys for iterating over phase model/thinking configuration
export const PHASE_KEYS: readonly (keyof PhaseModelConfig)[] = ['spec', 'planning', 'coding', 'qa'] as const;

// ============================================
// Codex (OpenAI) Models and Reasoning Effort
// ============================================

// Default Codex model used when no per-phase selection has been made yet
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';

// Default Codex reasoning effort used when no per-phase selection has been made yet
export const DEFAULT_CODEX_REASONING_EFFORT = 'high';

// Static fallback catalog used when runtime Codex model discovery is unavailable
// Keep in sync with the bundled list historically defined in TaskFormFields.tsx
export const CODEX_MODEL_CATALOG: { id: string; label: string; description?: string }[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Latest frontier agentic coding model.' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', description: 'Balanced agentic coding model for everyday work.' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', description: 'Fast and affordable agentic coding model.' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  { id: 'gpt-5.2', label: 'GPT-5.2' }
];

// Codex reasoning effort levels (must match CodexReasoningEffort in shared/types/task.ts)
export const CODEX_REASONING_LEVELS: { value: string; label: string; description?: string }[] = [
  { value: 'low', label: 'Low', description: 'Fastest, least deliberation' },
  { value: 'medium', label: 'Medium', description: 'Balanced speed and depth' },
  { value: 'high', label: 'High', description: 'Deeper reasoning' },
  { value: 'xhigh', label: 'X-High', description: 'Maximum reasoning depth' }
];

// ============================================
// Memory Backends
// ============================================

export const MEMORY_BACKENDS = [
  { value: 'file', label: 'File-based (default)' },
  { value: 'graphiti', label: 'Graphiti (LadybugDB)' }
] as const;
