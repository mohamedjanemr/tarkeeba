import { describe, expect, it } from 'vitest';
import type { Task } from '../../../../shared/types';
import {
  getTaskLifecycleProgress,
  getTaskStatusPresentation,
} from '../task-presentation';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-status-test',
    specId: 'status-test',
    projectId: 'project-status-test',
    title: 'Status test task',
    description: 'Verify task detail lifecycle status',
    status: 'backlog',
    subtasks: [],
    logs: [],
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('task detail presentation', () => {
  it('shows active validation instead of stale completed review state', () => {
    const task = createTask({
      status: 'human_review',
      reviewReason: 'completed',
      executionProgress: {
        phase: 'qa_review',
        phaseProgress: 40,
        overallProgress: 86,
      },
    });

    expect(getTaskStatusPresentation(task)).toEqual({
      labelKey: 'labels.validating',
      variant: 'purple',
      isActive: true,
    });
    expect(getTaskLifecycleProgress(task)).toBe(86);
  });

  it('shows QA-approved work as ready for review at 95 percent', () => {
    const task = createTask({
      status: 'human_review',
      reviewReason: 'completed',
      executionProgress: {
        phase: 'complete',
        phaseProgress: 100,
        overallProgress: 100,
      },
    });

    expect(getTaskStatusPresentation(task)).toEqual({
      labelKey: 'labels.readyForReview',
      variant: 'purple',
      isActive: false,
    });
    expect(getTaskLifecycleProgress(task)).toBe(95);
  });

  it('reserves 100 percent for a done task', () => {
    const task = createTask({ status: 'done' });

    expect(getTaskStatusPresentation(task).labelKey).toBe('columns.done');
    expect(getTaskLifecycleProgress(task)).toBe(100);
  });

  it('caps completed coding subtasks at the coding boundary', () => {
    const task = createTask({
      status: 'in_progress',
      subtasks: [
        {
          id: '1',
          title: 'Implement',
          description: 'Implement the change',
          status: 'completed',
          files: [],
        },
      ],
    });

    expect(getTaskLifecycleProgress(task)).toBe(80);
  });
});
