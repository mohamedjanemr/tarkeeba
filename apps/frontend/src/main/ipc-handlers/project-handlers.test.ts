/**
 * Tests for project IPC handlers
 *
 * Tests project:openLocation handler with support for:
 * - Opening a valid, existing directory (success case)
 * - Rejecting invalid/missing/insecure paths (failure case, shell.openPath never called)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron directly (rather than relying on the vitest alias) so ipcMain.handle
// is a plain vi.fn() we can inspect via .mock.calls, matching the pattern used by
// profile-handlers.test.ts
vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('electron')>('electron');
  return {
    ...actual,
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn()
    },
    shell: {
      ...actual.shell,
      openPath: vi.fn()
    }
  };
});

// Mock fs so we can control existsSync/statSync per test without touching the real filesystem
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn()
  };
});

// Partially mock the platform module: keep all real exports (isWindows, etc. are used
// by other modules pulled in transitively) but make isSecurePath deterministic per test
vi.mock('../platform', async () => {
  const actual = await vi.importActual<typeof import('../platform')>('../platform');
  return {
    ...actual,
    isSecurePath: vi.fn()
  };
});

import { registerProjectHandlers } from './project-handlers';
import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { existsSync, statSync } from 'fs';
import { isSecurePath } from '../platform';
import type { PythonEnvManager } from '../python-env-manager';
import type { AgentManager } from '../agent';

function getOpenLocationHandler() {
  const calls = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls.find((c) => c[0] === IPC_CHANNELS.PROJECT_OPEN_LOCATION);
  return call?.[1];
}

describe('project-handlers - openProjectLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerProjectHandlers(
      {
        on: vi.fn(),
        initialize: vi.fn().mockResolvedValue({ ready: false })
      } as unknown as PythonEnvManager,
      {} as unknown as AgentManager,
      () => null
    );
  });

  describe('valid directory', () => {
    it('calls shell.openPath and resolves { success: true }', async () => {
      vi.mocked(isSecurePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof statSync>);
      vi.mocked(shell.openPath).mockResolvedValue('');

      const handler = getOpenLocationHandler();
      const result = await handler({}, '/valid/project/path');

      expect(shell.openPath).toHaveBeenCalledWith('/valid/project/path');
      expect(result).toEqual({ success: true });
    });
  });

  describe('invalid/missing/insecure path', () => {
    it('resolves { success: false, error } and never calls shell.openPath for insecure paths', async () => {
      vi.mocked(isSecurePath).mockReturnValue(false);

      const handler = getOpenLocationHandler();
      const result = await handler({}, '../etc/passwd');

      expect(shell.openPath).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: expect.any(String) });
    });

    it('resolves { success: false, error } and never calls shell.openPath for missing paths', async () => {
      vi.mocked(isSecurePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const handler = getOpenLocationHandler();
      const result = await handler({}, '/does/not/exist');

      expect(shell.openPath).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: expect.any(String) });
    });

    it('resolves { success: false, error } and never calls shell.openPath when path is not a directory', async () => {
      vi.mocked(isSecurePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as unknown as ReturnType<typeof statSync>);

      const handler = getOpenLocationHandler();
      const result = await handler({}, '/valid/path/but/a/file.txt');

      expect(shell.openPath).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: expect.any(String) });
    });

    it('resolves { success: false, error } when shell.openPath itself reports a failure', async () => {
      vi.mocked(isSecurePath).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof statSync>);
      vi.mocked(shell.openPath).mockResolvedValue('Failed to open path');

      const handler = getOpenLocationHandler();
      const result = await handler({}, '/valid/project/path');

      expect(result).toEqual({ success: false, error: 'Failed to open path' });
    });
  });
});
