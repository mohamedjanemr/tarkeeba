import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAIProfileManager } from './openai-profile-manager';

const tempDirs: string[] = [];

function createManager(): { manager: OpenAIProfileManager; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'auto-claude-openai-'));
  tempDirs.push(root);
  return { manager: new OpenAIProfileManager(root), root };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('OpenAIProfileManager', () => {
  it('creates isolated homes and selects the first account', () => {
    const { manager } = createManager();
    const profile = manager.createProfile('Work OpenAI');

    expect(manager.getSettings().activeProfileId).toBe(profile.id);
    expect(readFileSync(join(profile.codexHome, 'config.toml'), 'utf8')).toContain('cli_auth_credentials_store = "file"');
    if (process.platform !== 'win32') {
      expect(statSync(profile.codexHome).mode & 0o777).toBe(0o700);
    }
  });

  it('persists active selection and authentication without exposing credentials', () => {
    const { manager, root } = createManager();
    const first = manager.createProfile('Personal');
    const second = manager.createProfile('Work');
    manager.setAuthentication(second.id, true, 'chatgpt');
    manager.setActiveProfile(second.id);

    const reloaded = new OpenAIProfileManager(root).getSettings();
    expect(reloaded.activeProfileId).toBe(second.id);
    expect(reloaded.profiles.find(profile => profile.id === second.id)?.isAuthenticated).toBe(true);
    expect(JSON.stringify(reloaded)).not.toContain('token');
    expect(first.codexHome).not.toBe(second.codexHome);
  });

  it('removes a profile home and safely selects the remaining account', () => {
    const { manager } = createManager();
    const first = manager.createProfile('First');
    const second = manager.createProfile('Second');
    manager.setActiveProfile(second.id);

    expect(manager.deleteProfile(second.id)).toBe(true);
    expect(manager.getSettings().activeProfileId).toBe(first.id);
    expect(() => statSync(second.codexHome)).toThrow();
  });
});
