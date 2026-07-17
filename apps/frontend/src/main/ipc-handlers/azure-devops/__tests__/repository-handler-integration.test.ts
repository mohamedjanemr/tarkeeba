import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../../shared/constants';
import { projectStore } from '../../../project-store';
import { registerCheckConnection } from '../repository-handlers';
import {
  azureDevOpsFetch,
  azureDevOpsFetchWithCount,
  getAzureDevOpsConfig
} from '../utils';

const testIpcMain = ipcMain as typeof ipcMain & {
  invokeHandler: (channel: string, event: unknown, ...args: unknown[]) => Promise<unknown>;
};

vi.mock('../../../project-store', () => ({
  projectStore: { getProject: vi.fn() }
}));

vi.mock('../utils', () => ({
  getAzureDevOpsConfig: vi.fn(),
  azureDevOpsFetch: vi.fn(),
  azureDevOpsFetchWithCount: vi.fn(),
  encodeProjectName: (value: string) => encodeURIComponent(value)
}));

describe('Azure DevOps repository handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcMain.removeHandler(IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION);
    registerCheckConnection();
  });

  it('loads project credentials and returns the renderer sync-status shape', async () => {
    vi.mocked(projectStore.getProject).mockReturnValue({ id: 'local-project' } as never);
    vi.mocked(getAzureDevOpsConfig).mockResolvedValue({
      pat: 'test-pat',
      organization: 'test-org',
      project: 'Azure Project'
    });
    vi.mocked(azureDevOpsFetch).mockResolvedValue({ id: 'ado-project', name: 'Azure Project' });
    vi.mocked(azureDevOpsFetchWithCount).mockResolvedValue({ data: {}, totalCount: 7 });

    const result = await testIpcMain.invokeHandler(
      IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION,
      {},
      'local-project'
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        connected: true,
        organizationName: 'test-org',
        projectName: 'Azure Project',
        projectId: 'ado-project',
        workItemCount: 7
      }
    });
    expect(azureDevOpsFetchWithCount).toHaveBeenCalledWith(
      'test-pat',
      'test-org',
      '/Azure%20Project/_apis/wit/wiql?api-version=7.1',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
