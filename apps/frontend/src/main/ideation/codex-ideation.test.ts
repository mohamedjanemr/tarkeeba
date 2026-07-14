import { describe, expect, it } from 'vitest';
import {
  buildCodexIdeationArgs,
  buildCodexIdeationPrompt,
  parseCodexIdeationEvent,
  parseCodexIdeationResponse,
} from './codex-ideation';
import type { IdeationConfig } from '../../shared/types';

const config: IdeationConfig = {
  enabledTypes: ['code_improvements'],
  includeRoadmapContext: true,
  includeKanbanContext: false,
  maxIdeasPerType: 3,
};

describe('Codex ideation adapter', () => {
  it('uses read-only Codex execution', () => {
    expect(buildCodexIdeationArgs('/repo', 'gpt-test', 'medium')).toEqual(expect.arrayContaining([
      '--sandbox', 'read-only', '--cd', '/repo', '--model', 'gpt-test'
    ]));
  });

  it('requests the selected types and limit', () => {
    const prompt = buildCodexIdeationPrompt(config);
    expect(prompt).toContain('at most 3');
    expect(prompt).toContain('code_improvements');
  });

  it('extracts the final Codex agent message', () => {
    expect(parseCodexIdeationEvent(JSON.stringify({
      type: 'item.completed', item: { type: 'agent_message', text: '{"code_improvements":[]}' }
    }))).toBe('{"code_improvements":[]}');
  });

  it('normalizes parsed ideas', () => {
    const result = parseCodexIdeationResponse(
      '{"code_improvements":[{"title":"A","description":"B","rationale":"C"}]}',
      ['code_improvements']
    );
    expect(result.code_improvements[0]).toMatchObject({ type: 'code_improvements', status: 'draft', title: 'A' });
  });
});
