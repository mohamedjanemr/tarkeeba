import { IPC_CHANNELS } from '../../shared/constants';
import type { CodexModelInfo, IPCResult, OpenAIProfile, OpenAIProfileSettings } from '../../shared/types';
import { invokeIpc } from './modules/ipc-utils';

export interface CodexAPI {
  listCodexModels: (profileId?: string) => Promise<IPCResult<CodexModelInfo[]>>;
  getOpenAIProfiles: () => Promise<IPCResult<OpenAIProfileSettings>>;
  createOpenAIProfile: (name: string) => Promise<IPCResult<OpenAIProfile>>;
  renameOpenAIProfile: (profileId: string, name: string) => Promise<IPCResult>;
  deleteOpenAIProfile: (profileId: string) => Promise<IPCResult>;
  setActiveOpenAIProfile: (profileId: string) => Promise<IPCResult>;
  loginOpenAIProfile: (profileId: string) => Promise<IPCResult>;
  verifyOpenAIProfile: (profileId: string) => Promise<IPCResult<{ authenticated: boolean; authMethod?: OpenAIProfile['authMethod'] }>>;
}

export const createCodexAPI = (): CodexAPI => ({
  listCodexModels: (profileId?: string) => invokeIpc(IPC_CHANNELS.CODEX_LIST_MODELS, profileId),
  getOpenAIProfiles: () => invokeIpc(IPC_CHANNELS.CODEX_PROFILES_GET),
  createOpenAIProfile: (name: string) => invokeIpc(IPC_CHANNELS.CODEX_PROFILE_CREATE, name),
  renameOpenAIProfile: (profileId: string, name: string) => invokeIpc(IPC_CHANNELS.CODEX_PROFILE_RENAME, profileId, name),
  deleteOpenAIProfile: (profileId: string) => invokeIpc(IPC_CHANNELS.CODEX_PROFILE_DELETE, profileId),
  setActiveOpenAIProfile: (profileId: string) => invokeIpc(IPC_CHANNELS.CODEX_PROFILE_SET_ACTIVE, profileId),
  loginOpenAIProfile: (profileId: string) => invokeIpc(IPC_CHANNELS.CODEX_PROFILE_LOGIN, profileId),
  verifyOpenAIProfile: (profileId: string) => invokeIpc(IPC_CHANNELS.CODEX_PROFILE_VERIFY, profileId),
});
