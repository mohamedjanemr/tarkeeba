/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../shared/types';

import '../../lib/browser-mock';

// PhaseProgressIndicator (rendered for in-progress tasks) observes visibility
// via IntersectionObserver, which jsdom does not implement.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../stores/task-store', () => ({
  archiveTasks: vi.fn(),
  checkTaskRunning: vi.fn().mockResolvedValue(true),
  hasRecentActivity: vi.fn(),
  isIncompleteHumanReview: vi.fn(() => false),
  recoverStuckTask: vi.fn(),
  startTaskOrQueue: vi.fn(),
  stopTask: vi.fn(),
}));

import { TaskCard } from '../TaskCard';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-duration-test',
    specId: 'duration-test',
    projectId: 'project-duration-test',
    title: 'A task used for duration badge tests',
    description: 'A normal description',
    status: 'backlog',
    subtasks: [],
    logs: [],
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
    updatedAt: new Date('2026-07-14T00:00:00.000Z'),
    ...overrides,
  };
}

describe('TaskCard duration badge', () => {
  it('does not show a duration badge for a backlog task with no timestamps in progress', () => {
    render(
      <TaskCard
        task={createTask({ status: 'backlog' })}
        onClick={vi.fn()}
      />
    );

    expect(screen.queryByTitle('labels.totalDuration')).not.toBeInTheDocument();
  });

  it('shows a non-empty duration badge for an in_progress task with valid timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T01:00:00.000Z'));

    try {
      render(
        <TaskCard
          task={createTask({
            status: 'in_progress',
            createdAt: new Date('2026-07-14T00:00:00.000Z'),
            updatedAt: new Date('2026-07-14T01:00:00.000Z'),
          })}
          onClick={vi.fn()}
        />
      );

      const badge = screen.getByTitle('labels.totalDuration');
      expect(badge).toHaveTextContent('1h');

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(badge).toHaveTextContent('1h 1m');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a non-empty duration badge for a done task with valid timestamps', () => {
    render(
      <TaskCard
        task={createTask({
          status: 'done',
          createdAt: new Date('2026-07-14T00:00:00.000Z'),
          updatedAt: new Date('2026-07-14T02:30:00.000Z'),
        })}
        onClick={vi.fn()}
      />
    );

    const badge = screen.getByTitle('labels.totalDuration');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent?.trim().length).toBeGreaterThan(0);
  });
});
