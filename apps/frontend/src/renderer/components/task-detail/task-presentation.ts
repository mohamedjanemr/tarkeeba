import { calculateProgress } from '../../lib/utils';
import type { ExecutionPhase, Task } from '../../../shared/types';

export type TaskStatusBadgeVariant =
  | 'secondary'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info'
  | 'purple';

export interface TaskStatusPresentation {
  labelKey: string;
  variant: TaskStatusBadgeVariant;
  isActive: boolean;
}

const ACTIVE_EXECUTION_PHASES = new Set<ExecutionPhase>([
  'planning',
  'coding',
  'rate_limit_paused',
  'auth_failure_paused',
  'qa_review',
  'qa_fixing',
]);

const ACTIVE_PHASE_PRESENTATION: Partial<
  Record<ExecutionPhase, Omit<TaskStatusPresentation, 'isActive'>>
> = {
  planning: { labelKey: 'execution.phases.planning', variant: 'warning' },
  coding: { labelKey: 'execution.phases.coding', variant: 'info' },
  rate_limit_paused: { labelKey: 'execution.phases.rate_limit_paused', variant: 'warning' },
  auth_failure_paused: { labelKey: 'execution.phases.auth_failure_paused', variant: 'destructive' },
  qa_review: { labelKey: 'labels.validating', variant: 'purple' },
  qa_fixing: { labelKey: 'execution.phases.fixing', variant: 'warning' },
};

export function isTaskExecutionActive(task: Task): boolean {
  return task.executionProgress
    ? ACTIVE_EXECUTION_PHASES.has(task.executionProgress.phase)
    : false;
}

/**
 * Returns one lifecycle status for the task detail header.
 * Active execution takes precedence over persisted column/review state so a
 * running QA phase can never be presented as completed.
 */
export function getTaskStatusPresentation(task: Task): TaskStatusPresentation {
  const executionPhase = task.executionProgress?.phase;
  if (executionPhase && ACTIVE_EXECUTION_PHASES.has(executionPhase)) {
    const phasePresentation = ACTIVE_PHASE_PRESENTATION[executionPhase];
    if (phasePresentation) {
      return { ...phasePresentation, isActive: true };
    }
  }

  if (task.status === 'human_review') {
    switch (task.reviewReason) {
      case 'completed':
        return { labelKey: 'labels.readyForReview', variant: 'purple', isActive: false };
      case 'errors':
        return { labelKey: 'reviewReason.hasErrors', variant: 'destructive', isActive: false };
      case 'qa_rejected':
        return { labelKey: 'reviewReason.qaIssues', variant: 'warning', isActive: false };
      case 'plan_review':
        return { labelKey: 'reviewReason.approvePlan', variant: 'purple', isActive: false };
      case 'stopped':
        return { labelKey: 'reviewReason.stopped', variant: 'warning', isActive: false };
      default:
        return { labelKey: 'columns.human_review', variant: 'purple', isActive: false };
    }
  }

  switch (task.status) {
    case 'done':
      return { labelKey: 'columns.done', variant: 'success', isActive: false };
    case 'pr_created':
      return { labelKey: 'columns.pr_created', variant: 'success', isActive: false };
    case 'in_progress':
      return { labelKey: 'columns.in_progress', variant: 'info', isActive: true };
    case 'ai_review':
      return { labelKey: 'columns.ai_review', variant: 'purple', isActive: true };
    case 'error':
      return { labelKey: 'columns.error', variant: 'destructive', isActive: false };
    case 'queue':
      return { labelKey: 'columns.queue', variant: 'secondary', isActive: false };
    default:
      return { labelKey: 'columns.backlog', variant: 'secondary', isActive: false };
  }
}

/** Overall workflow progress, including QA and final human approval. */
export function getTaskLifecycleProgress(task: Task): number {
  if (task.status === 'done' || task.status === 'pr_created') {
    return 100;
  }

  if (isTaskExecutionActive(task)) {
    return Math.min(task.executionProgress?.overallProgress ?? 0, 95);
  }

  if (task.status === 'human_review') {
    if (task.reviewReason === 'plan_review') {
      return 20;
    }
    if (task.reviewReason === 'completed') {
      return 95;
    }
  }

  const codingProgress = calculateProgress(task.subtasks);
  if (task.status === 'in_progress') {
    return Math.round(20 + codingProgress * 0.6);
  }
  if (task.status === 'ai_review') {
    return 80;
  }

  return codingProgress;
}
