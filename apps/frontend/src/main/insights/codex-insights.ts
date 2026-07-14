import type { CodexReasoningEffort } from '../../shared/types';

export const DEFAULT_CODEX_INSIGHTS_MODEL = 'gpt-5.6-sol';
export const DEFAULT_CODEX_INSIGHTS_EFFORT: CodexReasoningEffort = 'high';

export interface CodexInsightsEvent {
  type: 'text' | 'tool_start' | 'tool_end' | 'error';
  content?: string;
  tool?: { name: string; input?: string };
  error?: string;
}

export function buildCodexInsightsPrompt(
  message: string,
  history: Array<{ role: string; content: string }>
): string {
  const previousConversation = history
    .slice(0, -1)
    .map((entry) => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`)
    .join('\n\n');
  const question = message || 'Analyze the attached image(s).';

  return `You are the read-only Insights agent for Tarkeeba. Help the user understand the repository in your current working directory.

You may inspect files and run non-mutating discovery commands. Do not edit files, create files, apply patches, commit changes, or run commands that modify the repository.

When the user asks to create a task, or when a task would be helpful, output a suggestion on a single line in this exact format:
__TASK_SUGGESTION__:{"title":"Task title","description":"Detailed task description","metadata":{"category":"feature","complexity":"medium","impact":"medium"}}

Keep answers concise, actionable, and grounded in the repository.${
    previousConversation ? `\n\nPrevious conversation:\n${previousConversation}` : ''
  }

Current question: ${question}`;
}

export function buildCodexInsightsArgs(
  projectPath: string,
  model: string,
  effort: CodexReasoningEffort,
  imagePaths: string[]
): string[] {
  const args = [
    'exec',
    '--json',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    '--cd',
    projectPath,
    '--ephemeral',
    '--model',
    model,
    '--config',
    `model_reasoning_effort="${effort}"`,
  ];

  for (const imagePath of imagePaths) {
    args.push('--image', imagePath);
  }
  args.push('-');
  return args;
}

function toolInput(item: Record<string, unknown>): string | undefined {
  const value = item.command ?? item.server ?? item.tool ?? item.name;
  if (Array.isArray(value)) return value.join(' ');
  return typeof value === 'string' ? value : undefined;
}

export function parseCodexInsightsEvent(line: string): CodexInsightsEvent | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const eventType = event.type;
  if (eventType === 'turn.failed' || eventType === 'error') {
    const rawError = event.error;
    const error = typeof rawError === 'string'
      ? rawError
      : rawError && typeof rawError === 'object' && 'message' in rawError
        ? String((rawError as { message: unknown }).message)
        : typeof event.message === 'string'
          ? event.message
          : 'Codex execution failed';
    return { type: 'error', error };
  }

  if (eventType !== 'item.started' && eventType !== 'item.completed') return null;
  const item = event.item;
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const itemType = record.type;

  if (eventType === 'item.completed' && itemType === 'agent_message') {
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    return text ? { type: 'text', content: text } : null;
  }

  if (itemType === 'command_execution' || itemType === 'mcp_tool_call') {
    const name = itemType === 'command_execution' ? 'Shell' : 'MCP';
    const tool = { name, input: toolInput(record) };
    return eventType === 'item.started'
      ? { type: 'tool_start', tool }
      : { type: 'tool_end', tool };
  }

  return null;
}
