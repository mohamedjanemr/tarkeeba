import { describe, expect, it } from 'vitest';
import {
  AGENT_PHASES,
  AGENT_PROVIDER_REGISTRY,
  AGENT_PROVIDERS,
  CLAUDE_PROVIDER_DEFINITION,
  CODEX_PROVIDER_DEFINITION,
  getProviderDefinition,
  getProviderPreset,
  isKnownProviderModel,
  isValidProviderReasoning,
  normalizeProviderAgentSettings,
  normalizeProviderPhaseMap,
  normalizeProviderPhaseSelection
} from './registry';

describe('AGENT_PROVIDER_REGISTRY', () => {
  it('exposes both claude and codex provider definitions', () => {
    expect(AGENT_PROVIDER_REGISTRY.claude).toBe(CLAUDE_PROVIDER_DEFINITION);
    expect(AGENT_PROVIDER_REGISTRY.codex).toBe(CODEX_PROVIDER_DEFINITION);
    expect(AGENT_PROVIDERS).toHaveLength(2);
  });

  it('gives claude a managed account, presets, and Fast Mode capability', () => {
    expect(CLAUDE_PROVIDER_DEFINITION.accountMode).toBe('managed');
    expect(CLAUDE_PROVIDER_DEFINITION.modelSource).toBe('static');
    expect(CLAUDE_PROVIDER_DEFINITION.capabilities.fastMode).toBe(true);
    expect(CLAUDE_PROVIDER_DEFINITION.capabilities.presets).toBe(true);
    expect(CLAUDE_PROVIDER_DEFINITION.presets?.length).toBeGreaterThan(0);
  });

  it('gives codex a user-selectable account, runtime models, and no Fast Mode', () => {
    expect(CODEX_PROVIDER_DEFINITION.accountMode).toBe('user-selectable');
    expect(CODEX_PROVIDER_DEFINITION.modelSource).toBe('runtime');
    expect(CODEX_PROVIDER_DEFINITION.capabilities.fastMode).toBe(false);
    expect(CODEX_PROVIDER_DEFINITION.capabilities.presets).toBe(false);
    expect(CODEX_PROVIDER_DEFINITION.presets ?? []).toHaveLength(0);
    expect(CODEX_PROVIDER_DEFINITION.reasoningOptions.map((o) => o.value)).toEqual(
      expect.arrayContaining(['low', 'medium', 'high', 'xhigh'])
    );
  });

  it('defines complete four-phase defaults for every provider', () => {
    for (const definition of AGENT_PROVIDERS) {
      for (const phase of AGENT_PHASES) {
        expect(definition.phaseDefaults[phase]).toBeDefined();
        expect(definition.phaseDefaults[phase].model).toBeTruthy();
        expect(definition.phaseDefaults[phase].reasoning).toBeTruthy();
      }
    }
  });
});

describe('getProviderDefinition', () => {
  it('resolves known providers', () => {
    expect(getProviderDefinition('claude').id).toBe('claude');
    expect(getProviderDefinition('codex').id).toBe('codex');
  });

  it('falls back to claude for missing/unknown providers', () => {
    expect(getProviderDefinition(undefined).id).toBe('claude');
    expect(getProviderDefinition(null).id).toBe('claude');
  });
});

describe('getProviderPreset', () => {
  it('finds an existing claude preset by ID', () => {
    const preset = getProviderPreset('claude', 'balanced');
    expect(preset?.id).toBe('balanced');
  });

  it('returns undefined for unknown preset IDs', () => {
    expect(getProviderPreset('claude', 'does-not-exist')).toBeUndefined();
  });

  it('returns undefined for providers without presets', () => {
    expect(getProviderPreset('codex', 'anything')).toBeUndefined();
  });
});

describe('isKnownProviderModel / isValidProviderReasoning', () => {
  it('recognizes catalog models and rejects unknown ones', () => {
    expect(isKnownProviderModel('claude', 'sonnet')).toBe(true);
    expect(isKnownProviderModel('claude', 'not-a-real-model')).toBe(false);
    expect(isKnownProviderModel('codex', 'gpt-5.6-sol')).toBe(true);
  });

  it('recognizes valid reasoning values per provider', () => {
    expect(isValidProviderReasoning('claude', 'high')).toBe(true);
    expect(isValidProviderReasoning('claude', 'xhigh')).toBe(false);
    expect(isValidProviderReasoning('codex', 'xhigh')).toBe(true);
  });
});

describe('normalizeProviderPhaseSelection', () => {
  it('falls back to provider defaults when nothing is provided', () => {
    const selection = normalizeProviderPhaseSelection('claude', 'coding', undefined);
    expect(selection).toEqual(CLAUDE_PROVIDER_DEFINITION.phaseDefaults.coding);
  });

  it('preserves an unknown/saved model instead of replacing it', () => {
    const selection = normalizeProviderPhaseSelection('claude', 'coding', {
      model: 'some-future-model',
      reasoning: 'medium'
    });
    expect(selection.model).toBe('some-future-model');
    expect(selection.reasoning).toBe('medium');
  });

  it('falls back to the provider default reasoning for invalid values', () => {
    const selection = normalizeProviderPhaseSelection('claude', 'qa', {
      model: 'sonnet',
      reasoning: 'not-a-real-level'
    });
    expect(selection.model).toBe('sonnet');
    expect(selection.reasoning).toBe(CLAUDE_PROVIDER_DEFINITION.phaseDefaults.qa.reasoning);
  });

  it('applies codex defaults for a missing phase selection', () => {
    const selection = normalizeProviderPhaseSelection('codex', 'planning', undefined);
    expect(selection).toEqual(CODEX_PROVIDER_DEFINITION.phaseDefaults.planning);
  });
});

describe('normalizeProviderPhaseMap', () => {
  it('fills in every phase, mixing provided and default values', () => {
    const map = normalizeProviderPhaseMap('claude', {
      coding: { model: 'opus', reasoning: 'high' }
    });
    expect(map.coding).toEqual({ model: 'opus', reasoning: 'high' });
    expect(map.spec).toEqual(CLAUDE_PROVIDER_DEFINITION.phaseDefaults.spec);
    expect(map.planning).toEqual(CLAUDE_PROVIDER_DEFINITION.phaseDefaults.planning);
    expect(map.qa).toEqual(CLAUDE_PROVIDER_DEFINITION.phaseDefaults.qa);
  });

  it('returns full provider defaults when given undefined', () => {
    const map = normalizeProviderPhaseMap('codex', undefined);
    expect(map).toEqual(CODEX_PROVIDER_DEFINITION.phaseDefaults);
  });
});

describe('normalizeProviderAgentSettings', () => {
  it('drops an unknown presetId while keeping accountId and normalized phases', () => {
    const settings = normalizeProviderAgentSettings('claude', {
      accountId: 'account-1',
      presetId: 'not-a-real-preset',
      phases: { coding: { model: 'opus', reasoning: 'high' } }
    });
    expect(settings.accountId).toBe('account-1');
    expect(settings.presetId).toBeUndefined();
    expect(settings.phases.coding).toEqual({ model: 'opus', reasoning: 'high' });
    expect(settings.phases.spec).toEqual(CLAUDE_PROVIDER_DEFINITION.phaseDefaults.spec);
  });

  it('keeps a valid presetId', () => {
    const settings = normalizeProviderAgentSettings('claude', { presetId: 'quick', phases: undefined });
    expect(settings.presetId).toBe('quick');
  });

  it('normalizes an entirely missing settings object to provider defaults', () => {
    const settings = normalizeProviderAgentSettings('codex', undefined);
    expect(settings.presetId).toBeUndefined();
    expect(settings.accountId).toBeUndefined();
    expect(settings.phases).toEqual(CODEX_PROVIDER_DEFINITION.phaseDefaults);
  });
});
