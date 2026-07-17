import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../../shared/constants';
import { registerAzureDevOpsHandlers } from '../index';

describe('Azure DevOps handler registration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('registers every required handler family without duplicate invoke channels', () => {
    const handleSpy = vi.spyOn(ipcMain, 'handle');
    const onSpy = vi.spyOn(ipcMain, 'on');

    registerAzureDevOpsHandlers(
      {} as Parameters<typeof registerAzureDevOpsHandlers>[0],
      () => null
    );

    const handleChannels = handleSpy.mock.calls.map(([channel]) => channel);
    const eventChannels = onSpy.mock.calls.map(([channel]) => channel);

    expect(new Set(handleChannels).size).toBe(handleChannels.length);
    expect(handleChannels).toEqual(expect.arrayContaining([
      IPC_CHANNELS.AZURE_DEVOPS_SAVE_PAT,
      IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION,
      IPC_CHANNELS.AZURE_DEVOPS_GET_ISSUES,
      IPC_CHANNELS.AZURE_DEVOPS_IMPORT_ISSUES,
      IPC_CHANNELS.AZURE_DEVOPS_CREATE_PULL_REQUEST,
      IPC_CHANNELS.AZURE_DEVOPS_PR_GET_DIFF,
      IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_GET_CONFIG,
      IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_GET_CONFIG
    ]));
    expect(eventChannels).toEqual(expect.arrayContaining([
      IPC_CHANNELS.AZURE_DEVOPS_INVESTIGATE_ISSUE,
      IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW,
      IPC_CHANNELS.AZURE_DEVOPS_AUTOFIX_START,
      IPC_CHANNELS.AZURE_DEVOPS_TRIAGE_RUN
    ]));
  });
});
