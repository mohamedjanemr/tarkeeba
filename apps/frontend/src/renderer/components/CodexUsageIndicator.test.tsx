/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexUsageIndicator } from './CodexUsageIndicator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'common:usage.codexUsageStatus': 'Codex usage status',
      'common:usage.codexQuota': 'Codex Usage',
      'common:usage.window5Hour': '5-hour window',
      'common:usage.window7Day': '7-day window',
      'common:usage.codexPrimary': 'Primary quota',
      'common:usage.codexSecondary': 'Secondary quota',
      'common:usage.refreshUsage': 'Refresh usage',
      'common:usage.notAvailable': 'N/A',
      'common:usage.loading': 'Loading...',
      'common:usage.codexUnavailable': 'Codex usage unavailable',
      'common:usage.codexUnavailableDescription': 'Usage unavailable.',
      'common:usage.clickToOpenSettings': 'Open Settings',
    } as Record<string, string>)[key] || key,
  }),
}));

describe('CodexUsageIndicator', () => {
  beforeEach(() => {
    window.electronAPI.getCodexUsage = vi.fn().mockResolvedValue({
      success: true,
      data: {
        status: 'available',
        snapshot: {
          profileId: 'openai-test',
          profileName: 'Codex Test',
          fetchedAt: new Date().toISOString(),
          windows: [
            { kind: 'primary', percentUsed: 25, durationMinutes: 300 },
            { kind: 'secondary', percentUsed: 75, durationMinutes: 10_080 },
          ],
        },
      },
    });
    window.electronAPI.onCodexUsageUpdated = vi.fn(() => vi.fn());
  });

  it('shows the limiting percentage and both Codex quota windows', async () => {
    render(<CodexUsageIndicator profileId="openai-test" onOpenAccounts={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Codex usage status' }));

    expect(await screen.findByText('Codex Usage')).toBeInTheDocument();
    expect(screen.getByText('5-hour window')).toBeInTheDocument();
    expect(screen.getByText('7-day window')).toBeInTheDocument();
    expect(screen.getByText('Codex Test')).toBeInTheDocument();
  });

  it('shows a visible unavailable state', async () => {
    window.electronAPI.getCodexUsage = vi.fn().mockResolvedValue({
      success: true,
      data: {
        status: 'unavailable',
        profileId: 'openai-test',
        fetchedAt: new Date().toISOString(),
        reason: 'not-authenticated',
        message: 'This Codex account is not signed in.',
      },
    });

    render(<CodexUsageIndicator profileId="openai-test" onOpenAccounts={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('N/A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Codex usage status' }));

    expect(await screen.findByText('This Codex account is not signed in.')).toBeInTheDocument();
  });
});
