import type { TaskLogPhase, TaskMetadata } from '../../../shared/types';
import type { ModelTypeShort, ThinkingLevel } from '../../../shared/types/settings';

const MODEL_SHORT_LABELS: Record<ModelTypeShort, string> = {
  fable: 'Fable 5',
  opus: 'Opus 4.8',
  'opus-4.8': 'Opus 4.8',
  'opus-4.7': 'Opus 4.7',
  'opus-4.6': 'Opus 4.6',
  'opus-1m': 'Opus (1M)',
  'opus-4.5': 'Opus 4.5',
  sonnet: 'Sonnet 5',
  'sonnet-5': 'Sonnet 5',
  'sonnet-4.6': 'Sonnet 4.6',
  'sonnet-4.5': 'Sonnet 4.5',
  haiku: 'Haiku 4.5'
};

const THINKING_SHORT_LABELS: Record<ThinkingLevel, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High'
};

export interface PhaseConfigDisplay {
  label?: string;
  model: string;
  thinking: string;
}

function formatConfig(
  metadata: TaskMetadata,
  phase: 'spec' | 'planning' | 'coding' | 'qa',
  label?: string
): PhaseConfigDisplay | null {
  const model = metadata.phaseModels?.[phase];
  const thinking = metadata.phaseThinking?.[phase];
  if (!model || !thinking) return null;

  return {
    label,
    model: MODEL_SHORT_LABELS[model] || model,
    thinking: THINKING_SHORT_LABELS[thinking] || thinking
  };
}

/** Resolve every model represented by a task-log section.
 *
 * The planning log contains both spec creation and implementation planning,
 * which may use different models for customized profiles.
 */
export function getPhaseConfigDisplays(
  metadata: TaskMetadata | undefined,
  logPhase: TaskLogPhase
): PhaseConfigDisplay[] {
  if (!metadata) return [];

  if (metadata.isAutoProfile && metadata.phaseModels && metadata.phaseThinking) {
    if (logPhase === 'planning') {
      return [
        formatConfig(metadata, 'spec', 'Spec'),
        formatConfig(metadata, 'planning', 'Plan')
      ].filter((config): config is PhaseConfigDisplay => config !== null);
    }

    const configPhase = logPhase === 'coding' ? 'coding' : 'qa';
    const config = formatConfig(metadata, configPhase);
    return config ? [config] : [];
  }

  if (metadata.model && metadata.thinkingLevel) {
    return [{
      model: MODEL_SHORT_LABELS[metadata.model] || metadata.model,
      thinking: THINKING_SHORT_LABELS[metadata.thinkingLevel] || metadata.thinkingLevel
    }];
  }

  return [];
}
