import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Activity, AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CodexUsageResult, CodexUsageWindow } from '../../shared/types';
import { formatTimeRemaining } from '../../shared/utils/format-time';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const AUTO_REFRESH_INTERVAL_MS = 60_000;

function getTextColor(percent: number): string {
  if (percent >= 95) return 'text-red-500';
  if (percent >= 91) return 'text-orange-500';
  if (percent >= 71) return 'text-yellow-500';
  return 'text-green-500';
}

function getBadgeColors(percent: number): string {
  if (percent >= 95) return 'text-red-500 bg-red-500/10 border-red-500/20';
  if (percent >= 91) return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
  if (percent >= 71) return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
  return 'text-green-500 bg-green-500/10 border-green-500/20';
}

function getBarColor(percent: number): string {
  if (percent >= 95) return 'bg-red-500';
  if (percent >= 91) return 'bg-orange-500';
  if (percent >= 71) return 'bg-yellow-500';
  return 'bg-green-500';
}

interface CodexUsageIndicatorProps {
  profileId?: string;
  onOpenAccounts: (event: MouseEvent) => void;
}

export function CodexUsageIndicator({ profileId, onOpenAccounts }: CodexUsageIndicatorProps) {
  const { t } = useTranslation(['common']);
  const [result, setResult] = useState<CodexUsageResult | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestGeneration = useRef(0);
  const refreshInFlight = useRef(false);
  const translationRef = useRef(t);
  translationRef.current = t;

  const refresh = useCallback(async (forceRefresh = false) => {
    if (refreshInFlight.current) return;

    const generation = ++requestGeneration.current;
    refreshInFlight.current = true;
    setIsRefreshing(true);
    try {
      const response = await window.electronAPI.getCodexUsage(profileId, forceRefresh);
      if (generation !== requestGeneration.current) return;

      if (response.success && response.data) {
        setResult(response.data);
      } else {
        setResult({
          status: 'unavailable',
          profileId,
          fetchedAt: new Date().toISOString(),
          reason: 'unavailable',
          message: response.error || translationRef.current('common:usage.codexUnavailableDescription'),
        });
      }
    } catch {
      if (generation === requestGeneration.current) {
        setResult({
          status: 'unavailable',
          profileId,
          fetchedAt: new Date().toISOString(),
          reason: 'unavailable',
          message: translationRef.current('common:usage.codexUnavailableDescription'),
        });
      }
    } finally {
      if (generation === requestGeneration.current) setIsRefreshing(false);
      refreshInFlight.current = false;
    }
  }, [profileId]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onCodexUsageUpdated((event) => {
      if (!profileId || event.profileId === profileId) setResult(event.result);
    });
    void refresh();

    return () => {
      requestGeneration.current += 1;
      unsubscribe();
    };
  }, [profileId, refresh]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = window.setInterval(() => void refresh(true), AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isOpen, refresh]);

  const snapshot = result?.status === 'available' ? result.snapshot : undefined;
  const limitingPercent = snapshot
    ? Math.max(...snapshot.windows.map((window) => window.percentUsed))
    : 0;
  const unavailable = result?.status === 'unavailable';

  const handleOpenAccounts = (event: MouseEvent) => {
    setIsOpen(false);
    onOpenAccounts(event);
  };

  const windowLabel = (window: CodexUsageWindow): string => {
    if (window.durationMinutes === 300) return t('common:usage.window5Hour');
    if (window.durationMinutes === 10_080) return t('common:usage.window7Day');
    return window.kind === 'primary'
      ? t('common:usage.codexPrimary')
      : t('common:usage.codexSecondary');
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 ${
            unavailable
              ? 'bg-muted/50 text-muted-foreground'
              : getBadgeColors(limitingPercent)
          }`}
          aria-label={t('common:usage.codexUsageStatus')}
        >
          {unavailable ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Activity className={`h-3.5 w-3.5 ${!result ? 'motion-safe:animate-pulse' : ''}`} />
          )}
          <span className="text-xs font-semibold">
            {unavailable
              ? t('common:usage.notAvailable')
              : snapshot
                ? `${Math.round(limitingPercent)}%`
                : t('common:usage.loading')}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent side="bottom" align="end" className="w-72 space-y-3 p-3 text-xs">
        <div className="flex items-center justify-between border-b pb-2">
          <div>
            <p className="font-semibold">{t('common:usage.codexQuota')}</p>
            {snapshot && <p className="text-[10px] text-muted-foreground">{snapshot.profileName}</p>}
          </div>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={isRefreshing}
            className="rounded p-1 hover:bg-muted disabled:cursor-wait"
            aria-label={t('common:usage.refreshUsage')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
          </button>
        </div>

        {snapshot ? (
          <>
            {snapshot.windows.map((window) => (
              <div key={window.kind} className="space-y-1.5">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{windowLabel(window)}</span>
                  <span className={getTextColor(window.percentUsed)}>
                    {Math.round(window.percentUsed)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${getBarColor(window.percentUsed)}`}
                    style={{ width: `${window.percentUsed}%` }}
                  />
                </div>
                {window.resetAt && (
                  <p className="text-[10px] text-muted-foreground">
                    {formatTimeRemaining(window.resetAt, t)}
                  </p>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={handleOpenAccounts}
              className="w-full border-t pt-2 text-left text-muted-foreground hover:text-foreground"
            >
              {t('common:usage.clickToOpenSettings')}
            </button>
          </>
        ) : (
          <div className="space-y-2">
            <p className="font-medium">{t('common:usage.codexUnavailable')}</p>
            <p className="text-[11px] text-muted-foreground">
              {result?.status === 'unavailable'
                ? result.message
                : t('common:usage.codexUnavailableDescription')}
            </p>
            <button type="button" onClick={handleOpenAccounts} className="text-primary underline">
              {t('common:usage.clickToOpenSettings')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
