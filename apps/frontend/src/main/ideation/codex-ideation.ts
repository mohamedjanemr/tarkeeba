import type { CodexReasoningEffort, IdeationConfig, IdeationType } from '../../shared/types';

export const DEFAULT_CODEX_IDEATION_MODEL = 'gpt-5.6-sol';
export const DEFAULT_CODEX_IDEATION_EFFORT: CodexReasoningEffort = 'high';

const TYPE_FIELDS: Record<IdeationType, string> = {
  code_improvements: 'builds_upon:string[], estimated_effort:trivial|small|medium|large|complex, affected_files:string[], existing_patterns:string[], implementation_approach:string',
  ui_ux_improvements: 'category:usability|accessibility|performance|visual|interaction, affected_components:string[], current_state:string, proposed_change:string, user_benefit:string',
  documentation_gaps: 'category:readme|api_docs|inline_comments|examples|architecture|troubleshooting, target_audience:developers|users|contributors|maintainers, affected_areas:string[], current_documentation:string, proposed_content:string, priority:low|medium|high, estimated_effort:trivial|small|medium',
  security_hardening: 'category:authentication|authorization|input_validation|data_protection|dependencies|configuration|secrets_management, severity:low|medium|high|critical, affected_files:string[], vulnerability:string, current_risk:string, remediation:string, references:string[], compliance:string[]',
  performance_optimizations: 'category:bundle_size|runtime|memory|database|network|rendering|caching, impact:low|medium|high, affected_areas:string[], current_metric:string, expected_improvement:string, implementation:string, tradeoffs:string, estimated_effort:trivial|small|medium|large',
  code_quality: 'category:large_files|code_smells|complexity|duplication|naming|structure|linting|testing|types|dependencies|dead_code|git_hygiene, severity:suggestion|minor|major|critical, affected_files:string[], current_state:string, proposed_change:string, code_example:string, best_practice:string, metrics:object, estimated_effort:trivial|small|medium|large, breaking_change:boolean, prerequisites:string[]',
};

export function buildCodexIdeationArgs(
  projectPath: string,
  model: string,
  effort: CodexReasoningEffort
): string[] {
  return [
    'exec', '--json', '--color', 'never', '--sandbox', 'read-only', '--cd', projectPath,
    '--ephemeral', '--model', model, '--config', `model_reasoning_effort="${effort}"`, '-'
  ];
}

export function buildCodexIdeationPrompt(config: IdeationConfig): string {
  const schemas = config.enabledTypes
    .map((type) => `- ${type}: ${TYPE_FIELDS[type]}`)
    .join('\n');

  return `You are Tarkeeba's repository ideation agent. Inspect the repository in the current working directory and propose concrete, evidence-based improvements.

This is read-only analysis. Do not edit, create, or delete files. Ground every idea in files and patterns you actually inspect. Avoid duplicating functionality that already exists. Generate at most ${config.maxIdeasPerType} strong ideas for each requested type.

Return ONLY one valid JSON object, with no markdown fences or commentary. Its keys must be exactly the requested type names and each value must be an array of ideas. Every idea requires these common fields: id (unique kebab-case string), type (the exact key), title, description, rationale, status ("draft"), created_at (ISO timestamp). Type-specific fields:
${schemas}

Requested types: ${config.enabledTypes.join(', ')}
Use roadmap context: ${config.includeRoadmapContext}
Use kanban context: ${config.includeKanbanContext}`;
}

export function parseCodexIdeationEvent(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type !== 'item.completed') return null;
    const item = event.item;
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    return record.type === 'agent_message' && typeof record.text === 'string'
      ? record.text.trim()
      : null;
  } catch {
    return null;
  }
}

export function parseCodexIdeationResponse(
  response: string,
  enabledTypes: IdeationType[]
): Record<IdeationType, Array<Record<string, unknown>>> {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const raw = JSON.parse(fenced || trimmed) as Record<string, unknown>;
  const result = {} as Record<IdeationType, Array<Record<string, unknown>>>;

  for (const type of enabledTypes) {
    const ideas = raw[type];
    if (!Array.isArray(ideas)) throw new Error(`Codex response is missing the ${type} ideas array`);
    result[type] = ideas.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Codex returned an invalid ${type} idea at position ${index + 1}`);
      }
      const idea = value as Record<string, unknown>;
      for (const field of ['title', 'description', 'rationale']) {
        if (typeof idea[field] !== 'string' || !idea[field]) {
          throw new Error(`Codex returned a ${type} idea without ${field}`);
        }
      }
      return {
        ...idea,
        id: typeof idea.id === 'string' && idea.id ? idea.id : `${type}-${Date.now()}-${index + 1}`,
        type,
        status: 'draft',
        created_at: typeof idea.created_at === 'string' ? idea.created_at : new Date().toISOString(),
      };
    });
  }
  return result;
}
