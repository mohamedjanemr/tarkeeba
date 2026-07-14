/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../shared/types';

import '../../lib/browser-mock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../stores/task-store', () => ({
  archiveTasks: vi.fn(),
  checkTaskRunning: vi.fn(),
  hasRecentActivity: vi.fn(),
  isIncompleteHumanReview: vi.fn(() => false),
  recoverStuckTask: vi.fn(),
  startTaskOrQueue: vi.fn(),
  stopTask: vi.fn(),
}));

import { TaskCard } from '../TaskCard';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-layout-test',
    specId: 'layout-test',
    projectId: 'project-layout-test',
    title: 'A task with normal content',
    description: 'A normal description',
    status: 'backlog',
    subtasks: [],
    logs: [],
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
    updatedAt: new Date('2026-07-14T00:00:00.000Z'),
    ...overrides,
  };
}

describe('TaskCard layout containment', () => {
  it('contains long unbroken task text within the card width', () => {
    const title = 'RemoveOldClaudeCodeInstallBadgeFromSidebarWithoutBreakingProviderSelection';
    const description =
      'apps/frontend/src/renderer/components/Sidebar/ProviderInstallStatus/ExtremelyLongUnbrokenPath.tsx';

    const { container } = render(
      <TaskCard
        task={createTask({ title, description })}
        onClick={vi.fn()}
      />
    );

    expect(container.querySelector('.task-card-enhanced')).toHaveClass(
      'w-full',
      'min-w-0',
      'max-w-full',
      'overflow-hidden'
    );
    expect(screen.getByText(title)).toHaveClass('break-words');
    expect(screen.getByText(description)).toHaveClass('break-words');
  });
});
