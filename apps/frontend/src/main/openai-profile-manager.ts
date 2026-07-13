import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAIProfile, OpenAIProfileSettings } from '../shared/types';

interface StoredProfiles extends OpenAIProfileSettings {
  version: 1;
}

export class OpenAIProfileManager {
  private readonly rootDir: string;
  private readonly storePath: string;
  private data: StoredProfiles;

  constructor(userDataPath = app.getPath('userData')) {
    this.rootDir = join(userDataPath, 'codex-profiles');
    this.storePath = join(userDataPath, 'openai-profiles.json');
    mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    this.data = this.load();
  }

  private load(): StoredProfiles {
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, 'utf8')) as StoredProfiles;
      return { version: 1, profiles: parsed.profiles ?? [], activeProfileId: parsed.activeProfileId ?? null };
    } catch {
      return { version: 1, profiles: [], activeProfileId: null };
    }
  }

  private save(): void {
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    chmodSync(this.storePath, 0o600);
  }

  private initializeHome(codexHome: string): void {
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    chmodSync(codexHome, 0o700);
    const configPath = join(codexHome, 'config.toml');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
    }
  }

  getSettings(): OpenAIProfileSettings {
    return { profiles: this.data.profiles.map(profile => ({ ...profile })), activeProfileId: this.data.activeProfileId };
  }

  getProfile(profileId?: string | null): OpenAIProfile | undefined {
    const id = profileId || this.data.activeProfileId;
    return id ? this.data.profiles.find(profile => profile.id === id) : undefined;
  }

  createProfile(name: string): OpenAIProfile {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Account name is required');
    const id = `openai-${randomUUID()}`;
    const codexHome = join(this.rootDir, id);
    this.initializeHome(codexHome);
    const now = new Date().toISOString();
    const profile: OpenAIProfile = {
      id,
      name: trimmedName,
      codexHome,
      isAuthenticated: false,
      createdAt: now,
      updatedAt: now,
    };
    this.data.profiles.push(profile);
    this.data.activeProfileId ??= id;
    this.save();
    return { ...profile };
  }

  renameProfile(profileId: string, name: string): boolean {
    const profile = this.getProfile(profileId);
    if (!profile || !name.trim()) return false;
    profile.name = name.trim();
    profile.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  setActiveProfile(profileId: string): boolean {
    if (!this.getProfile(profileId)) return false;
    this.data.activeProfileId = profileId;
    this.save();
    return true;
  }

  setAuthentication(profileId: string, authenticated: boolean, authMethod?: OpenAIProfile['authMethod']): void {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error('OpenAI account not found');
    profile.isAuthenticated = authenticated;
    profile.authMethod = authenticated ? authMethod : undefined;
    profile.updatedAt = new Date().toISOString();
    this.save();
  }

  deleteProfile(profileId: string): boolean {
    const index = this.data.profiles.findIndex(profile => profile.id === profileId);
    if (index === -1) return false;
    const [profile] = this.data.profiles.splice(index, 1);
    rmSync(profile.codexHome, { recursive: true, force: true });
    if (this.data.activeProfileId === profileId) {
      this.data.activeProfileId = this.data.profiles[0]?.id ?? null;
    }
    this.save();
    return true;
  }
}

let manager: OpenAIProfileManager | null = null;

export function getOpenAIProfileManager(): OpenAIProfileManager {
  manager ??= new OpenAIProfileManager();
  return manager;
}
