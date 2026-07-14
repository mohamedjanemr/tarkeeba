/**
 * @vitest-environment jsdom
 */
/**
 * UsageCostDashboard Tests
 *
 * Regression coverage for the QA-flagged gap where the per-task cost breakdown table,
 * the "Active Run Cost" KPI, and the project-level account/provider breakdown never
 * received real data because nothing ever called `loadTaskUsageDetail()` with a real
 * spec ID. These tests mount the full dashboard with mocked IPC responses containing
 * non-empty task/project data and assert the breakdown UI renders real rows/values
 * (not its permanently-empty placeholders) without requiring any user interaction
 * beyond navigating to the dashboard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../../shared/i18n';
import { UsageCostDashboard } from './UsageCostDashboard';
import { useTaskStore } from '../../stores/task-store';
import { useUsageCostStore } from '../../stores/usage-cost-store';
import type { Task } from '../../../shared/types';
import type { ProjectUsageSummary, UsageData } from '../../../preload/api/modules/usage-cost-api';

// Mock Radix Select to make the task picker testable in jsdom (portals don't render there).
let currentSelectOnValueChange: ((value: string) => void) | null = null;
vi.mock('../ui/select', () => {
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value: string;
      onValueChange: (v: string) => void;
      children: React.ReactNode;
    }) => {
      currentSelectOnValueChange = onValueChange;
      return <div data-testid="task-select" data-value={value}>{children}</div>;
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <button type="button" data-testid="task-select-trigger">{children}</button>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
      <div data-testid={`task-select-item-${value}`}>{children}</div>
    )
  };
});

/** Simulates picking a task from the (mocked) task selector dropdown. */
function selectTask(specId: string): void {
  currentSelectOnValueChange?.(specId);
}

const mockGetProjectUsageSummary = vi.fn();
const mockGetTaskUsageDetail = vi.fn();
const mockOnUsageCostUpdated = vi.fn(() => vi.fn());

Object.defineProperty(window, 'electronAPI', {
  value: {
    getProjectUsageSummary: mockGetProjectUsageSummary,
    getTaskUsageDetail: mockGetTaskUsageDetail,
    onUsageCostUpdated: mockOnUsageCostUpdated
  },
  writable: true
});

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.specId as string,
    specId: 'spec-1',
    projectId: 'project-1',
    title: 'Task',
    description: '',
    status: 'done',
    subtasks: [],
    logs: [],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides
  };
}

const olderTask = makeTask({
  id: 'task-1',
  specId: 'spec-1',
  title: 'Older Task',
  updatedAt: new Date('2024-01-01T00:00:00.000Z')
});

const newerTask = makeTask({
  id: 'task-2',
  specId: 'spec-2',
  title: 'Newer Task',
  updatedAt: new Date('2024-02-01T00:00:00.000Z')
});

// Note: the project-level totals below intentionally use cost values distinct from the
// per-task fixtures further down, since they represent an aggregate across ALL of the
// project's tasks (not just the currently-selected one) - this keeps "$1.23"-style
// assertions unambiguous about which UI surface (KPI/table vs. project breakdown) they
// are checking.
const projectSummary: ProjectUsageSummary = {
  projectId: 'project-1',
  totals: { input_tokens: 9000, output_tokens: 4500, cost_usd: 7.59 },
  byAccount: {
    'acct-primary': { input_tokens: 6000, output_tokens: 3000, cost_usd: 4.56 },
    'acct-secondary': { input_tokens: 3000, output_tokens: 1500, cost_usd: 3.03 }
  },
  byModel: {
    'claude-3-opus': { input_tokens: 6000, output_tokens: 3000, cost_usd: 4.56 },
    'gpt-4': { input_tokens: 3000, output_tokens: 1500, cost_usd: 3.03 }
  },
  timeSeries: {},
  specCount: 2
};

const taskDetailSpec2: UsageData = {
  spec_id: 'spec-2',
  entries: [
    {
      timestamp: '2024-02-01T00:00:00.000Z',
      model: 'claude-3-opus',
      account: 'acct-primary',
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 1.23
    }
  ],
  totals: { input_tokens: 1000, output_tokens: 500, cost_usd: 1.23 }
};

const taskDetailSpec1: UsageData = {
  spec_id: 'spec-1',
  entries: [
    {
      timestamp: '2024-01-01T00:00:00.000Z',
      model: 'gpt-4',
      account: 'acct-secondary',
      input_tokens: 200,
      output_tokens: 100,
      cost_usd: 0.05
    }
  ],
  totals: { input_tokens: 200, output_tokens: 100, cost_usd: 0.05 }
};

describe('UsageCostDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSelectOnValueChange = null;

    useTaskStore.getState().clearTasks();

    const store = useUsageCostStore.getState();
    store.setProjectSummary(null);
    store.setTaskDetail(null);
    store.setAccountHeadroom(null);
    store.setPrediction(null);
    store.setSelectedSpecId(null);
    store.setError(null);
    store.setLoading(false);

    mockGetProjectUsageSummary.mockResolvedValue({
      success: true,
      data: { usage: projectSummary, accountHeadroom: null }
    });
    mockGetTaskUsageDetail.mockImplementation((_projectId: string, specId: string) =>
      Promise.resolve({
        success: true,
        data: specId === 'spec-2' ? taskDetailSpec2 : taskDetailSpec1
      })
    );
  });

  it('loads and shows real per-task breakdown/active-run cost for the most recently updated task, without any user interaction', async () => {
    useTaskStore.getState().setTasks([olderTask, newerTask]);

    render(<UsageCostDashboard projectId="project-1" />);

    // Defaults to the most recently updated task (spec-2), not the first/oldest one.
    await waitFor(() => {
      expect(mockGetTaskUsageDetail).toHaveBeenCalledWith('project-1', 'spec-2');
    });

    // The per-task breakdown table shows real rows, not its empty placeholder.
    await waitFor(() => {
      expect(screen.queryByText('No usage data for this task yet')).not.toBeInTheDocument();
    });
    const table = screen.getByRole('table');
    expect(within(table).getByText('acct-primary')).toBeInTheDocument();

    // $1.23 appears twice: once in the breakdown table row, once in the "Active Run
    // Cost" KPI card - both are real data, so the "no active runs" placeholder is gone.
    expect(screen.getAllByText('$1.23').length).toBe(2);
    expect(screen.queryByText('No active runs')).not.toBeInTheDocument();
  });

  it('renders the project-level spend-by-account and spend-by-provider breakdown from projectSummary', async () => {
    useTaskStore.getState().setTasks([newerTask]);

    render(<UsageCostDashboard projectId="project-1" />);

    await waitFor(() => {
      expect(mockGetProjectUsageSummary).toHaveBeenCalledWith('project-1');
    });

    const accountCard = screen.getByTestId('account-breakdown-card');
    const providerCard = screen.getByTestId('provider-breakdown-card');

    await waitFor(() => {
      expect(within(accountCard).getByText('acct-secondary')).toBeInTheDocument();
    });
    expect(within(accountCard).getByText('acct-primary')).toBeInTheDocument();
    expect(within(accountCard).getByText('$4.56')).toBeInTheDocument();
    expect(within(providerCard).getByText('Anthropic')).toBeInTheDocument();
    expect(within(providerCard).getByText('OpenAI')).toBeInTheDocument();
    expect(within(providerCard).getByText('$3.03')).toBeInTheDocument();
    expect(screen.queryByText('No account usage data yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No provider usage data yet')).not.toBeInTheDocument();
  });

  it('switches the breakdown to a different task when the user picks it from the task selector', async () => {
    useTaskStore.getState().setTasks([olderTask, newerTask]);

    render(<UsageCostDashboard projectId="project-1" />);

    await waitFor(() => {
      expect(mockGetTaskUsageDetail).toHaveBeenCalledWith('project-1', 'spec-2');
    });
    await waitFor(() => {
      expect(within(screen.getByRole('table')).getByText('acct-primary')).toBeInTheDocument();
    });

    selectTask('spec-1');

    await waitFor(() => {
      expect(mockGetTaskUsageDetail).toHaveBeenCalledWith('project-1', 'spec-1');
    });
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('acct-secondary')).toBeInTheDocument();
      expect(within(table).queryByText('acct-primary')).not.toBeInTheDocument();
    });
  });

  it('shows empty placeholders and hides the task selector when the project has no tasks', async () => {
    useTaskStore.getState().setTasks([]);
    mockGetProjectUsageSummary.mockResolvedValue({
      success: true,
      data: {
        usage: {
          projectId: 'project-1',
          totals: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
          byAccount: {},
          byModel: {},
          timeSeries: {},
          specCount: 0
        },
        accountHeadroom: null
      }
    });

    render(<UsageCostDashboard projectId="project-1" />);

    await waitFor(() => {
      expect(mockGetProjectUsageSummary).toHaveBeenCalledWith('project-1');
    });

    expect(screen.queryByTestId('task-select')).not.toBeInTheDocument();
    expect(mockGetTaskUsageDetail).not.toHaveBeenCalled();
    expect(screen.getByText('No usage data for this task yet')).toBeInTheDocument();
    expect(screen.getByText('No active runs')).toBeInTheDocument();
  });
});
