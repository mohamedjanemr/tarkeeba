/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the GeneralSettings "Project Location" section:
 * - Renders the project path
 * - Copy Path calls navigator.clipboard.writeText and shows a success toast
 * - Open Folder success shows a success toast
 * - Open Folder failure shows a destructive toast with the error message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { GeneralSettings } from '../GeneralSettings';
import i18n from '../../../../shared/i18n';
import type { Project, ProjectSettings as ProjectSettingsType } from '../../../../shared/types';
import type { ElectronAPI } from '../../../../shared/types/ipc';

const toastMock = vi.fn();
const openProjectLocationMock = vi.fn<ElectronAPI['openProjectLocation']>();

vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

const mockProject: Project = {
  id: 'project-1',
  name: 'Test Project',
  path: '/Users/test/projects/test-project',
  autoBuildPath: '',
  settings: {} as ProjectSettingsType,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSettings: ProjectSettingsType = {
  model: 'sonnet',
  memoryBackend: 'file',
  linearSync: false,
  notifications: {
    onTaskComplete: true,
    onTaskFailed: true,
    onReviewNeeded: true,
    sound: false,
  },
  graphitiMcpEnabled: false,
  useClaudeMd: true,
};

function renderGeneralSettings(overrides: Partial<Project> = {}) {
  return renderWithI18n(
    <GeneralSettings
      project={{ ...mockProject, ...overrides }}
      settings={mockSettings}
      setSettings={vi.fn()}
      versionInfo={null}
      isCheckingVersion={false}
      isUpdating={false}
      handleInitialize={vi.fn()}
    />
  );
}

describe('GeneralSettings - Project Location', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    openProjectLocationMock.mockReset().mockResolvedValue({ success: true });
    global.window.electronAPI = {
      openProjectLocation: openProjectLocationMock,
    } as unknown as ElectronAPI;
  });

  it('renders the project path', () => {
    renderGeneralSettings();

    expect(screen.getByText(mockProject.path)).toBeInTheDocument();
  });

  it('copies the project path to the clipboard and shows a success toast', async () => {
    renderGeneralSettings();

    fireEvent.click(screen.getByText(/copy path/i));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockProject.path);
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/copied/i) })
      );
    });
  });

  it('shows a success toast when opening the folder succeeds', async () => {
    openProjectLocationMock.mockResolvedValue({ success: true });

    renderGeneralSettings();

    fireEvent.click(screen.getByText(/open folder/i));

    await waitFor(() => {
      expect(openProjectLocationMock).toHaveBeenCalledWith(mockProject.path);
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/opened/i) })
      );
    });
  });

  it('shows a destructive toast with the error message when opening the folder fails', async () => {
    openProjectLocationMock.mockResolvedValue({
      success: false,
      error: 'Path does not exist',
    });

    renderGeneralSettings();

    fireEvent.click(screen.getByText(/open folder/i));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: 'Path does not exist',
        })
      );
    });
  });
});
