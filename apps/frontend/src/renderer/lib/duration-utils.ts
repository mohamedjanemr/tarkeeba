import type { TaskLogPhase, TaskLogs, TaskStatus } from '@shared/types/task';

/**
 * Duration (in milliseconds) for each task log phase, keyed by phase name.
 * A phase is omitted entirely if it never started (no started_at).
 */
export type PhaseDurations = Partial<Record<TaskLogPhase, number>>;

const PHASE_ORDER: TaskLogPhase[] = ['planning', 'coding', 'validation'];

/**
 * Calculate the duration of each phase in a task's logs.
 *
 * - A phase with no `started_at` is omitted (it hasn't started yet).
 * - A phase with `started_at` but no `completed_at` is still in progress;
 *   its duration is computed against the current time.
 * - A completed phase's duration is `completed_at - started_at`.
 *
 * @param logs Task logs, or null if not yet available
 * @returns Map of phase name to duration in milliseconds
 */
export function calculatePhaseDurations(logs: TaskLogs | null): PhaseDurations {
  const durations: PhaseDurations = {};
  if (!logs) return durations;

  const now = Date.now();

  for (const phase of PHASE_ORDER) {
    const phaseLog = logs.phases[phase];
    if (!phaseLog || !phaseLog.started_at) continue;

    const startedAt = new Date(phaseLog.started_at).getTime();
    const endedAt = phaseLog.completed_at ? new Date(phaseLog.completed_at).getTime() : now;

    durations[phase] = Math.max(0, endedAt - startedAt);
  }

  return durations;
}

/**
 * Calculate the total duration spanning all phases of a task.
 *
 * This is the span from the earliest phase `started_at` to the latest phase
 * `completed_at` (or now, if any phase is still in progress) — not the sum
 * of individual phase durations, since there may be gaps between phases.
 *
 * @param logs Task logs, or null if not yet available
 * @returns Total duration in milliseconds, or null if no phase has started
 */
export function calculateTotalDuration(logs: TaskLogs | null): number | null {
  if (!logs) return null;

  const now = Date.now();
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;
  let anyInProgress = false;

  for (const phase of PHASE_ORDER) {
    const phaseLog = logs.phases[phase];
    if (!phaseLog || !phaseLog.started_at) continue;

    const startedAt = new Date(phaseLog.started_at).getTime();
    if (earliestStart === null || startedAt < earliestStart) {
      earliestStart = startedAt;
    }

    if (phaseLog.completed_at) {
      const completedAt = new Date(phaseLog.completed_at).getTime();
      if (latestEnd === null || completedAt > latestEnd) {
        latestEnd = completedAt;
      }
    } else {
      anyInProgress = true;
    }
  }

  if (earliestStart === null) return null;

  const end = anyInProgress ? now : (latestEnd ?? earliestStart);
  return Math.max(0, end - earliestStart);
}

/**
 * Format a duration in milliseconds as a compact, human-readable string,
 * consistent with the project's relative-time style (see formatRelativeTime
 * in ./utils.ts).
 *
 * Examples: '< 1m', '12m', '1h 5m', '1d 3h'
 *
 * @param ms Duration in milliseconds
 * @returns Compact formatted duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;

  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalMinutes < 1) return '< 1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  if (totalHours < 24) {
    const remainingMinutes = totalMinutes % 60;
    return remainingMinutes > 0 ? `${totalHours}h ${remainingMinutes}m` : `${totalHours}h`;
  }

  const remainingHours = totalHours % 24;
  return remainingHours > 0 ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
}

/**
 * Approximate total duration for a task at the card level, for use where the
 * full phase logs (TaskLogs) aren't loaded (e.g. TaskCard, which only has
 * task-level timestamps available — TaskLogs is loaded lazily via
 * useTaskDetail for the detail view).
 *
 * - Returns null for tasks that haven't started execution yet ('backlog' or
 *   'queue' status).
 * - For finished tasks ('done'), the span is createdAt -> updatedAt.
 * - For all other (in-progress) statuses, the span is createdAt -> now.
 *
 * @param createdAt Task creation timestamp
 * @param updatedAt Task last-updated timestamp
 * @param status Current task status
 * @returns Approximate duration in milliseconds, or null if the task hasn't started
 */
export function calculateApproxDurationFromTimestamps(
  createdAt: Date | string,
  updatedAt: Date | string,
  status: TaskStatus
): number | null {
  if (status === 'backlog' || status === 'queue') return null;

  const start = new Date(createdAt).getTime();
  if (Number.isNaN(start)) return null;

  const end = status === 'done' ? new Date(updatedAt).getTime() : Date.now();
  if (Number.isNaN(end)) return null;

  return Math.max(0, end - start);
}
