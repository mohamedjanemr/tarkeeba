/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskLogs as TaskLogsType, TaskPhaseLog } from '../../../../shared/types';

import '../../../lib/browser-mock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../stores/settings-store', () => ({
  useSettingsStore: (selector: (state: { settings: { logOrder: string } } ) => unknown) =>
    selector({ settings: { logOrder: 'chronological' } }),
}));

import { TaskLogs } from '../TaskLogs';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-duration-test',
    specId: 'duration-test',
    projectId: 'project-duration-test',
    title: 'A task used to verify duration rendering',
    description: 'A task description',
    status: 'coding',
    subtasks: [],
    logs: [],
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    updatedAt: new Date('2026-07-16T00:00:00.000Z'),
    ...overrides,
  };
}

function createPhaseLog(overrides: Partial<TaskPhaseLog> = {}): TaskPhaseLog {
  return {
    phase: 'planning',
    status: 'pending',
    started_at: null,
    completed_at: null,
    entries: [],
    ...overrides,
  };
}

function createPhaseLogs(): TaskLogsType {
  return {
    spec_id: 'duration-test',
    created_at: '2026-07-16T00:00:00.000Z',
    updated_at: '2026-07-16T00:25:00.000Z',
    phases: {
      planning: createPhaseLog({
        phase: 'planning',
        status: 'completed',
        started_at: '2026-07-16T00:00:00.000Z',
        completed_at: '2026-07-16T00:10:00.000Z',
      }),
      coding: createPhaseLog({
        phase: 'coding',
        status: 'active',
        started_at: '2026-07-16T00:10:00.000Z',
        completed_at: null,
      }),
      validation: createPhaseLog({
        phase: 'validation',
        status: 'pending',
        started_at: null,
        completed_at: null,
      }),
    },
  };
}

describe('TaskLogs per-phase duration breakdown', () => {
  beforeEach(() => {
    // Fix "now" so the in-progress coding phase produces a deterministic duration.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T00:25:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders formatted durations per phase and a total duration summary', () => {
    render(
      <TaskLogs
        task={createTask()}
        phaseLogs={createPhaseLogs()}
        isLoadingLogs={false}
        expandedPhases={new Set()}
        isStuck={false}
        logsEndRef={createRef<HTMLDivElement>()}
        logsContainerRef={createRef<HTMLDivElement>()}
        onLogsScroll={vi.fn()}
        onTogglePhase={vi.fn()}
      />
    );

    // Total duration summary rendered at the top of the panel.
    const totalLabel = screen.getByText('tasks:labels.totalDuration');
    const totalRow = totalLabel.closest('div');
    expect(totalRow).not.toBeNull();
    // planning (00:00 -> 00:10) plus coding still running until "now" (00:25) => 25m total.
    expect(within(totalRow as HTMLElement).getByText('25m')).toBeInTheDocument();

    // Planning: completed, 10 minute duration.
    const planningSection = screen.getByText('Planning').closest('button');
    expect(planningSection).not.toBeNull();
    expect(within(planningSection as HTMLElement).getByText('· 10m')).toBeInTheDocument();
    expect(within(planningSection as HTMLElement).getByText('Complete')).toBeInTheDocument();

    // Coding: in progress, duration computed against "now" (00:10 -> 00:25 = 15m).
    const codingSection = screen.getByText('Coding').closest('button');
    expect(codingSection).not.toBeNull();
    expect(within(codingSection as HTMLElement).getByText('· 15m')).toBeInTheDocument();
    expect(within(codingSection as HTMLElement).getByText('Running')).toBeInTheDocument();

    // Validation: not started, no duration shown, just the pending state.
    const validationSection = screen.getByText('Validation').closest('button');
    expect(validationSection).not.toBeNull();
    expect(within(validationSection as HTMLElement).queryByText(/^· /)).not.toBeInTheDocument();
    expect(within(validationSection as HTMLElement).getByText('Pending')).toBeInTheDocument();
  });
});
