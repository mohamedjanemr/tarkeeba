import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectSettings } from '../../../shared/types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';

type ConnectionState = 'idle' | 'checking' | 'connected' | 'disconnected';

interface AgentMemoryAccessSettingsProps {
  settings: ProjectSettings;
  onUpdateSettings: (updates: Partial<ProjectSettings>) => void;
}

function inferMode(settings: ProjectSettings): 'managed' | 'external' {
  if (settings.graphitiMcpMode) return settings.graphitiMcpMode;
  const url = settings.graphitiMcpUrl;
  if (url && !/^http:\/\/(localhost|127\.0\.0\.1):8000\/mcp\/?$/.test(url)) {
    return 'external';
  }
  return 'managed';
}

export function AgentMemoryAccessSettings({
  settings,
  onUpdateSettings
}: AgentMemoryAccessSettingsProps) {
  const { t } = useTranslation('settings');
  const mode = inferMode(settings);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  const checkConnection = useCallback(async () => {
    if (!settings.graphitiMcpEnabled) return;
    setConnectionState('checking');

    try {
      if (mode === 'managed') {
        const result = await window.electronAPI.getManagedMemoryMcpStatus();
        if (result.success && result.data?.running) {
          setConnectionState('connected');
          setConnectionMessage(
            t('projectSettings.memoryMcp.managedConnected', { port: result.data.port })
          );
        } else {
          setConnectionState('disconnected');
          setConnectionMessage(
            result.data?.error || result.error || t('projectSettings.memoryMcp.managedUnavailable')
          );
        }
        return;
      }

      const url = settings.graphitiMcpUrl?.trim();
      if (!url) {
        setConnectionState('disconnected');
        setConnectionMessage(t('projectSettings.memoryMcp.urlRequired'));
        return;
      }

      const result = await window.electronAPI.testMcpConnection({
        id: 'graphiti-memory',
        name: 'Graphiti Memory',
        type: 'http',
        url
      });
      if (result.success && result.data?.success) {
        setConnectionState('connected');
        setConnectionMessage(t('projectSettings.memoryMcp.externalConnected'));
      } else {
        setConnectionState('disconnected');
        setConnectionMessage(
          result.data?.error || result.data?.message || result.error || t('projectSettings.memoryMcp.externalUnavailable')
        );
      }
    } catch (error) {
      setConnectionState('disconnected');
      setConnectionMessage(
        error instanceof Error
          ? error.message
          : t(`projectSettings.memoryMcp.${mode === 'managed' ? 'managedUnavailable' : 'externalUnavailable'}`)
      );
    }
  }, [mode, settings.graphitiMcpEnabled, settings.graphitiMcpUrl, t]);

  useEffect(() => {
    if (!settings.graphitiMcpEnabled) {
      setConnectionState('idle');
      setConnectionMessage('');
      return;
    }
    const timeout = window.setTimeout(() => void checkConnection(), 350);
    return () => window.clearTimeout(timeout);
  }, [checkConnection, settings.graphitiMcpEnabled]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">
            {t('projectSettings.memoryMcp.enableLabel')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('projectSettings.memoryMcp.enableDescription')}
          </p>
        </div>
        <Switch
          checked={settings.graphitiMcpEnabled}
          onCheckedChange={(checked) => onUpdateSettings({ graphitiMcpEnabled: checked })}
        />
      </div>

      {settings.graphitiMcpEnabled && (
        <div className="ml-6 space-y-3">
          <div className="space-y-2">
            <Label>{t('projectSettings.memoryMcp.modeLabel')}</Label>
            <Select
              value={mode}
              onValueChange={(value) => onUpdateSettings({
                graphitiMcpMode: value as 'managed' | 'external'
              })}
            >
              <SelectTrigger data-testid="memory-mcp-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="managed">
                  {t('projectSettings.memoryMcp.managedOption')}
                </SelectItem>
                <SelectItem value="external">
                  {t('projectSettings.memoryMcp.externalOption')}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {mode === 'managed'
                ? t('projectSettings.memoryMcp.managedDescription')
                : t('projectSettings.memoryMcp.externalDescription')}
            </p>
          </div>

          {mode === 'external' && (
            <div className="space-y-2">
              <Label>{t('projectSettings.memoryMcp.urlLabel')}</Label>
              <Input
                placeholder="http://127.0.0.1:8321/mcp/"
                value={settings.graphitiMcpUrl || ''}
                onChange={(event) => onUpdateSettings({
                  graphitiMcpUrl: event.target.value || undefined
                })}
              />
            </div>
          )}

          <div
            data-testid="memory-mcp-status"
            className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${
              connectionState === 'connected'
                ? 'border-success/30 bg-success/10 text-success'
                : connectionState === 'disconnected'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-border bg-muted/30 text-muted-foreground'
            }`}
          >
            <div className="flex items-center gap-2">
              {connectionState === 'checking' && <Loader2 className="h-4 w-4 animate-spin" />}
              {connectionState === 'connected' && <CheckCircle2 className="h-4 w-4" />}
              {connectionState === 'disconnected' && <AlertCircle className="h-4 w-4" />}
              <span>
                {connectionState === 'checking'
                  ? t('projectSettings.memoryMcp.checking')
                  : connectionMessage || t('projectSettings.memoryMcp.notChecked')}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={connectionState === 'checking'}
              onClick={() => void checkConnection()}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              {t('projectSettings.memoryMcp.retry')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
