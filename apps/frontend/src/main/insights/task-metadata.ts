import type { InsightsProviderConfig, TaskMetadata } from '../../shared/types';

export function buildInsightsTaskMetadata(
  metadata?: TaskMetadata,
  providerConfig?: InsightsProviderConfig
): TaskMetadata {
  const taskMetadata: TaskMetadata = {
    ...metadata,
    sourceType: 'insights',
  };

  if (!providerConfig) return taskMetadata;

  taskMetadata.provider = providerConfig.provider;
  if (providerConfig.provider === 'codex') {
    taskMetadata.codexProfileId = providerConfig.codexProfileId;
    taskMetadata.codexModel = providerConfig.codexModel;
    taskMetadata.codexReasoningEffort = providerConfig.codexReasoningEffort;
  } else {
    delete taskMetadata.codexProfileId;
    delete taskMetadata.codexModel;
    delete taskMetadata.codexReasoningEffort;
  }

  return taskMetadata;
}
