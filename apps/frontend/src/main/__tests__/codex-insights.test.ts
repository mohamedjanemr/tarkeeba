import { describe, expect, it } from 'vitest';
import {
  buildCodexInsightsArgs,
  buildCodexInsightsPrompt,
  parseCodexInsightsEvent,
} from '../insights/codex-insights';
import { buildInsightsTaskMetadata } from '../insights/task-metadata';

describe('Codex Insights adapter', () => {
  it('preserves the selected Codex configuration on created tasks', () => {
    expect(buildInsightsTaskMetadata(
      { category: 'feature', complexity: 'medium' },
      {
        provider: 'codex',
        codexProfileId: 'openai-account-1',
        codexModel: 'gpt-test',
        codexReasoningEffort: 'high',
      }
    )).toEqual({
      sourceType: 'insights',
      category: 'feature',
      complexity: 'medium',
      provider: 'codex',
      codexProfileId: 'openai-account-1',
      codexModel: 'gpt-test',
      codexReasoningEffort: 'high',
    });
  });

  it('builds a read-only ephemeral command with images', () => {
    const args = buildCodexInsightsArgs('/repo', 'gpt-test', 'high', [
      '/tmp/first.png',
      '/tmp/second.jpg',
    ]);

    expect(args).toContain('read-only');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('gpt-test');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args.filter((value) => value === '--image')).toHaveLength(2);
    expect(args.at(-1)).toBe('-');
  });

  it('includes conversation history and the current question', () => {
    const prompt = buildCodexInsightsPrompt('What changed?', [
      { role: 'user', content: 'Inspect the API' },
      { role: 'assistant', content: 'I found the router.' },
      { role: 'user', content: 'What changed?' },
    ]);

    expect(prompt).toContain('User: Inspect the API');
    expect(prompt).toContain('Assistant: I found the router.');
    expect(prompt).toContain('Current question: What changed?');
    expect(prompt).toContain('Do not edit files');
  });

  it('parses messages, tools, and errors from Codex JSONL', () => {
    expect(parseCodexInsightsEvent(JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Answer' },
    }))).toEqual({ type: 'text', content: 'Answer' });

    expect(parseCodexInsightsEvent(JSON.stringify({
      type: 'item.started',
      item: { type: 'command_execution', command: 'rg TODO' },
    }))).toEqual({
      type: 'tool_start',
      tool: { name: 'Shell', input: 'rg TODO' },
    });

    expect(parseCodexInsightsEvent(JSON.stringify({
      type: 'turn.failed',
      error: { message: 'request failed' },
    }))).toEqual({ type: 'error', error: 'request failed' });
  });
});
