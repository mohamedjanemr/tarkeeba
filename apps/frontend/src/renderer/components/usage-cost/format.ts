/**
 * Shared formatting helpers for the usage-cost dashboard components (currency, token
 * counts, and best-effort provider labeling from a model identifier). Centralized here
 * so `CostSummaryCards`, `TaskCostBreakdownTable`, `ProjectCostBreakdown`,
 * `SpendOverTimeChart`, and `CostWarningModal` all share one implementation instead of
 * duplicating/diverging copies.
 */

/**
 * Formats a USD amount for display (e.g. $12.34, $0.0032 for very small amounts).
 */
export function formatCurrency(value: number): string {
  if (value > 0 && value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/** Formats a token count with locale-aware compact notation (e.g. 12.4K, 1.2M). */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1
  }).format(value);
}

/**
 * Best-effort provider label derived from the model identifier recorded on each usage entry.
 * There is no explicit provider field on UsageEntry, so this mirrors the naming conventions
 * used across the app's model pickers/config (e.g. "claude-*" -> Anthropic, "gpt-*"/"*codex*" -> OpenAI,
 * "glm-*" -> z.ai/Zhipu).
 *
 * Named distinctly from `getProviderLabel` in `shared/utils/provider-detection.ts` (which maps an
 * `ApiProvider` key, not a model identifier, to a label) to avoid the name collision/signature
 * mismatch between the two. Labels are aligned with that shared util's canonical strings
 * (e.g. `'z.ai'`, not `'Z.ai'`) so provider naming stays consistent across the UI.
 */
export function getProviderLabelFromModel(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.includes('claude')) return 'Anthropic';
  if (normalized.includes('gpt') || normalized.includes('codex') || normalized.startsWith('o1') || normalized.startsWith('o3')) {
    return 'OpenAI';
  }
  if (normalized.includes('glm') || normalized.includes('zhipu')) return 'z.ai';
  if (normalized.includes('gemini')) return 'Google';
  return 'Other';
}

export function getProviderBadgeVariant(provider: string): 'default' | 'info' | 'purple' | 'success' | 'muted' {
  switch (provider) {
    case 'Anthropic':
      return 'info';
    case 'OpenAI':
      return 'purple';
    case 'z.ai':
      return 'success';
    case 'Google':
      return 'default';
    default:
      return 'muted';
  }
}
