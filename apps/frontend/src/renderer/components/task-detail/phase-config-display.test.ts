import { describe, expect, it } from 'vitest';
import type { TaskMetadata } from '../../../shared/types';
import { getPhaseConfigDisplays } from './phase-config-display';

const customizedAutoMetadata: TaskMetadata = {
  isAutoProfile: true,
  phaseModels: {
    spec: 'sonnet-5',
    planning: 'fable',
    coding: 'sonnet-5',
    qa: 'opus'
  },
  phaseThinking: {
    spec: 'medium',
    planning: 'high',
    coding: 'medium',
    qa: 'low'
  }
};

describe('getPhaseConfigDisplays', () => {
  it('shows spec and implementation-planning models in the planning log', () => {
    expect(getPhaseConfigDisplays(customizedAutoMetadata, 'planning')).toEqual([
      { label: 'Spec', model: 'Sonnet 5', thinking: 'Med' },
      { label: 'Plan', model: 'Fable 5', thinking: 'High' }
    ]);
  });

  it('shows the configured coding and QA models in their own sections', () => {
    expect(getPhaseConfigDisplays(customizedAutoMetadata, 'coding')).toEqual([
      { model: 'Sonnet 5', thinking: 'Med' }
    ]);
    expect(getPhaseConfigDisplays(customizedAutoMetadata, 'validation')).toEqual([
      { model: 'Opus 4.8', thinking: 'Low' }
    ]);
  });

  it('keeps one model indicator for non-phase-specific profiles', () => {
    const metadata: TaskMetadata = {
      model: 'sonnet',
      thinkingLevel: 'medium'
    };

    expect(getPhaseConfigDisplays(metadata, 'planning')).toEqual([
      { model: 'Sonnet 5', thinking: 'Med' }
    ]);
  });
});
