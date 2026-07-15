/**
 * @vitest-environment jsdom
 */
/**
 * CostWarningModal Tests
 *
 * Verifies the modal subscribes to onCostWarningRequired, renders the predicted
 * cost/threshold, and calls confirmCostWarning with the correct taskId/approved
 * value when the user clicks Proceed, Cancel, or dismisses the dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../../shared/i18n';
import { CostWarningModal } from './CostWarningModal';
import type { CostWarningRequiredPayload } from '../../../preload/api/modules/usage-cost-api';

// Mock electronAPI
let capturedCallback: ((payload: CostWarningRequiredPayload) => void) | undefined;
const mockOnCostWarningRequired = vi.fn((callback: (payload: CostWarningRequiredPayload) => void) => {
  capturedCallback = callback;
  return vi.fn();
});
const mockConfirmCostWarning = vi.fn();

Object.defineProperty(window, 'electronAPI', {
  value: {
    onCostWarningRequired: mockOnCostWarningRequired,
    confirmCostWarning: mockConfirmCostWarning
  },
  writable: true
});

const payload: CostWarningRequiredPayload = {
  taskId: 'task-123',
  predictedCostUsd: 12.5,
  threshold: 10
};

describe('CostWarningModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallback = undefined;
    mockConfirmCostWarning.mockResolvedValue({ success: true, data: true });
  });

  it('should not render dialog content when no warning is pending', () => {
    render(<CostWarningModal />);

    expect(mockOnCostWarningRequired).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Cost Warning')).not.toBeInTheDocument();
  });

  it('should render the predicted cost and threshold when a warning arrives', async () => {
    render(<CostWarningModal />);

    expect(capturedCallback).toBeDefined();
    capturedCallback!(payload);

    await waitFor(() => {
      expect(screen.getByText('Cost Warning')).toBeInTheDocument();
    });

    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  });

  it('should call confirmCostWarning with approved=true when Proceed is clicked', async () => {
    render(<CostWarningModal />);
    capturedCallback!(payload);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /proceed/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /proceed/i }));

    await waitFor(() => {
      expect(mockConfirmCostWarning).toHaveBeenCalledWith('task-123', true);
    });

    // Modal should dismiss after resolving
    await waitFor(() => {
      expect(screen.queryByText('Cost Warning')).not.toBeInTheDocument();
    });
  });

  it('should call confirmCostWarning with approved=false when Cancel is clicked', async () => {
    render(<CostWarningModal />);
    capturedCallback!(payload);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(mockConfirmCostWarning).toHaveBeenCalledWith('task-123', false);
    });
  });

  it('should call confirmCostWarning with approved=false when the dialog is dismissed via escape', async () => {
    render(<CostWarningModal />);
    capturedCallback!(payload);

    await waitFor(() => {
      expect(screen.getByText('Cost Warning')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(mockConfirmCostWarning).toHaveBeenCalledWith('task-123', false);
    });
  });

  it('should disable the buttons while a submission is in flight', async () => {
    let resolveConfirm: (value: any) => void;
    mockConfirmCostWarning.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      })
    );

    render(<CostWarningModal />);
    capturedCallback!(payload);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /proceed/i })).toBeInTheDocument();
    });

    const proceedButton = screen.getByRole('button', { name: /proceed/i });
    fireEvent.click(proceedButton);

    await waitFor(() => {
      expect(proceedButton).toBeDisabled();
    });

    resolveConfirm!({ success: true, data: true });

    await waitFor(() => {
      expect(screen.queryByText('Cost Warning')).not.toBeInTheDocument();
    });
  });
});
