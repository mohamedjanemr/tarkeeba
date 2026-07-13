import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { CodexModelInfo, CodexReasoningEffort, IPCResult, OpenAIProfile, OpenAIProfileSettings } from '../../shared/types';
import { getAugmentedEnv } from '../env-utils';
import { getOpenAIProfileManager } from '../openai-profile-manager';

const execFileAsync = promisify(execFile);
const SUPPORTED_EFFORTS = new Set<CodexReasoningEffort>(['low', 'medium', 'high', 'xhigh']);

interface RawCodexModel {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: Array<{ effort?: unknown }>;
}

export function registerCodexHandlers(): void {
  const profileEnv = (profileId?: string): Record<string, string> => {
    const profile = getOpenAIProfileManager().getProfile(profileId);
    return profile ? { ...getAugmentedEnv(), CODEX_HOME: profile.codexHome } : getAugmentedEnv();
  };

  const verifyProfile = async (profileId: string): Promise<{ authenticated: boolean; authMethod?: OpenAIProfile['authMethod'] }> => {
    const manager = getOpenAIProfileManager();
    const profile = manager.getProfile(profileId);
    if (!profile) throw new Error('OpenAI account not found');
    try {
      const { stdout, stderr } = await execFileAsync('codex', ['login', 'status'], {
        env: profileEnv(profileId), timeout: 15_000,
      });
      const output = `${stdout}\n${stderr}`.toLowerCase();
      const authMethod = output.includes('api key') ? 'api-key' : 'chatgpt';
      manager.setAuthentication(profileId, true, authMethod);
      return { authenticated: true, authMethod };
    } catch {
      manager.setAuthentication(profileId, false);
      return { authenticated: false };
    }
  };

  ipcMain.handle(IPC_CHANNELS.CODEX_PROFILES_GET, async (): Promise<IPCResult<OpenAIProfileSettings>> => {
    return { success: true, data: getOpenAIProfileManager().getSettings() };
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_PROFILE_CREATE, async (_, name: string): Promise<IPCResult<OpenAIProfile>> => {
    try {
      return { success: true, data: getOpenAIProfileManager().createProfile(name) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create OpenAI account' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_PROFILE_RENAME, async (_, profileId: string, name: string): Promise<IPCResult> => {
    const success = getOpenAIProfileManager().renameProfile(profileId, name);
    return success ? { success: true } : { success: false, error: 'OpenAI account not found or name is invalid' };
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_PROFILE_DELETE, async (_, profileId: string): Promise<IPCResult> => {
    const success = getOpenAIProfileManager().deleteProfile(profileId);
    return success ? { success: true } : { success: false, error: 'OpenAI account not found' };
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_PROFILE_SET_ACTIVE, async (_, profileId: string): Promise<IPCResult> => {
    const success = getOpenAIProfileManager().setActiveProfile(profileId);
    return success ? { success: true } : { success: false, error: 'OpenAI account not found' };
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_PROFILE_VERIFY, async (_, profileId: string): Promise<IPCResult<{ authenticated: boolean; authMethod?: OpenAIProfile['authMethod'] }>> => {
    try {
      return { success: true, data: await verifyProfile(profileId) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to verify OpenAI account' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_PROFILE_LOGIN, async (_, profileId: string): Promise<IPCResult> => {
    const profile = getOpenAIProfileManager().getProfile(profileId);
    if (!profile) return { success: false, error: 'OpenAI account not found' };
    try {
      const child = spawn('codex', ['login'], {
        env: profileEnv(profileId), detached: false, stdio: 'ignore', windowsHide: true,
      });
      child.once('exit', () => { void verifyProfile(profileId); });
      child.unref();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to start OpenAI login' };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.CODEX_LIST_MODELS,
    async (_, profileId?: string): Promise<IPCResult<CodexModelInfo[]>> => {
      try {
        const { stdout } = await execFileAsync('codex', ['debug', 'models'], {
          env: profileEnv(profileId),
          timeout: 20_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        const catalog = JSON.parse(stdout) as { models?: RawCodexModel[] };
        const models = (catalog.models ?? [])
          .filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
          .map((model): CodexModelInfo => {
            const efforts = (model.supported_reasoning_levels ?? [])
              .map((level) => level.effort)
              .filter((effort): effort is CodexReasoningEffort =>
                typeof effort === 'string' && SUPPORTED_EFFORTS.has(effort as CodexReasoningEffort)
              );
            const defaultEffort = model.default_reasoning_level;
            return {
              id: model.slug as string,
              displayName: typeof model.display_name === 'string' ? model.display_name : model.slug as string,
              description: typeof model.description === 'string' ? model.description : undefined,
              defaultReasoningEffort: typeof defaultEffort === 'string' && SUPPORTED_EFFORTS.has(defaultEffort as CodexReasoningEffort)
                ? defaultEffort as CodexReasoningEffort
                : undefined,
              supportedReasoningEfforts: efforts,
            };
          });
        return { success: true, data: models };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unable to discover Codex models',
        };
      }
    }
  );
}
