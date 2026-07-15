/**
 * @vitest-environment jsdom
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/i18n';
import { AgentProfileSelector } from '../AgentProfileSelector';
import type { PhaseModelConfig, PhaseThinkingConfig } from '../../../shared/types/settings';

let selectProfile: ((value: string) => void) | null = null;

vi.mock('../ui/select', () => ({
  Select: ({ onValueChange, children }: { onValueChange: (value: string) => void; children: React.ReactNode }) => {
    selectProfile ??= onValueChange;
    return <div>{children}</div>;
  },
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

const complexDefaults: PhaseModelConfig = {
  spec: 'opus',
  planning: 'opus',
  coding: 'opus',
  qa: 'opus'
};

const customComplexModels: PhaseModelConfig = {
  spec: 'opus',
  planning: 'fable',
  coding: 'sonnet-5',
  qa: 'opus'
};

const customComplexThinking: PhaseThinkingConfig = {
  spec: 'high',
  planning: 'high',
  coding: 'high',
  qa: 'medium'
};

function renderSelector(configuredProfileId = 'complex') {
  const onPhaseModelsChange = vi.fn();
  const onPhaseThinkingChange = vi.fn();

  render(
    <AgentProfileSelector
      profileId="balanced"
      model="sonnet"
      thinkingLevel="medium"
      phaseModels={complexDefaults}
      phaseThinking={{ spec: 'high', planning: 'high', coding: 'high', qa: 'high' }}
      configuredProfileId={configuredProfileId}
      configuredPhaseModels={customComplexModels}
      configuredPhaseThinking={customComplexThinking}
      onProfileChange={vi.fn()}
      onModelChange={vi.fn()}
      onThinkingLevelChange={vi.fn()}
      onPhaseModelsChange={onPhaseModelsChange}
      onPhaseThinkingChange={onPhaseThinkingChange}
    />
  );

  return { onPhaseModelsChange, onPhaseThinkingChange };
}

describe('AgentProfileSelector saved phase settings', () => {
  beforeEach(() => {
    selectProfile = null;
  });

  it('reuses saved custom phases when selecting the configured profile', () => {
    const { onPhaseModelsChange, onPhaseThinkingChange } = renderSelector();

    act(() => selectProfile?.('complex'));

    expect(onPhaseModelsChange).toHaveBeenCalledWith(customComplexModels);
    expect(onPhaseThinkingChange).toHaveBeenCalledWith(customComplexThinking);
  });

  it('uses preset defaults when selecting a different profile', () => {
    const { onPhaseModelsChange, onPhaseThinkingChange } = renderSelector('balanced');

    act(() => selectProfile?.('complex'));

    expect(onPhaseModelsChange).toHaveBeenCalledWith(complexDefaults);
    expect(onPhaseThinkingChange).toHaveBeenCalledWith({
      spec: 'high',
      planning: 'high',
      coding: 'high',
      qa: 'high'
    });
  });
});
