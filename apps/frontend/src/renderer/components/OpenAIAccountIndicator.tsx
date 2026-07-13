import { useEffect, useState } from 'react';
import { Bot, Code2, LogIn } from 'lucide-react';
import type { OpenAIProfile } from '../../shared/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function OpenAIAccountIndicator() {
  const [profiles, setProfiles] = useState<OpenAIProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [activeProvider, setActiveProvider] = useState<'claude' | 'codex'>(() =>
    localStorage.getItem('auto-claude:agent-provider') === 'codex' ? 'codex' : 'claude'
  );

  const loadProfiles = async () => {
    const result = await window.electronAPI.getOpenAIProfiles();
    if (result.success && result.data) {
      setProfiles(result.data.profiles);
      setActiveProfileId(result.data.activeProfileId ?? '');
    }
  };

  useEffect(() => {
    void loadProfiles();
    const handleUpdate = () => { void loadProfiles(); };
    window.addEventListener('openai-profiles-updated', handleUpdate);
    return () => window.removeEventListener('openai-profiles-updated', handleUpdate);
  }, []);

  const handleChange = async (value: string) => {
    if (value === 'provider:claude') {
      setActiveProvider('claude');
      localStorage.setItem('auto-claude:agent-provider', 'claude');
      window.dispatchEvent(new CustomEvent('agent-provider-changed', { detail: { provider: 'claude' } }));
      return;
    }

    const profileId = value.replace(/^codex:/, '');
    const result = await window.electronAPI.setActiveOpenAIProfile(profileId);
    if (!result.success) return;
    setActiveProfileId(profileId);
    setActiveProvider('codex');
    localStorage.setItem('auto-claude:agent-provider', 'codex');
    window.dispatchEvent(new CustomEvent('openai-profiles-updated'));
    window.dispatchEvent(new CustomEvent('agent-provider-changed', { detail: { provider: 'codex', profileId } }));
  };

  const selectedValue = activeProvider === 'codex' && activeProfileId
    ? `codex:${activeProfileId}`
    : 'provider:claude';

  return (
    <Select value={selectedValue} onValueChange={handleChange}>
      <SelectTrigger className="h-8 w-auto min-w-36 gap-1.5 border-sky-500/20 bg-sky-500/10 text-sky-500" aria-label="Active coding agent">
        {activeProvider === 'codex' ? <Bot className="h-3.5 w-3.5 shrink-0" /> : <Code2 className="h-3.5 w-3.5 shrink-0" />}
        <SelectValue placeholder="Select coding agent" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="provider:claude">
          <span className="flex items-center gap-2"><Code2 className="h-3.5 w-3.5" />Claude Code</span>
        </SelectItem>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={`codex:${profile.id}`} disabled={!profile.isAuthenticated}>
            <span className="flex items-center gap-2">
              {profile.isAuthenticated ? <Bot className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5 text-muted-foreground" />}
              Codex: {profile.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
