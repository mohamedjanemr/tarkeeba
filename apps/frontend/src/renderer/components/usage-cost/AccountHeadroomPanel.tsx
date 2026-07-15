/**
 * Account Headroom Panel - per-account rate-limit/usage headroom for the Usage & Cost dashboard
 *
 * Shows each configured account's session/weekly usage headroom plus failover status
 * (active, rate-limited, needs re-authentication), so a user can tell at a glance whether
 * a long-running task will survive on the current account or needs to fail over.
 *
 * Reuses the same data shape (AllProfilesUsage / ProfileUsageSummary) and threshold-coloring
 * conventions as UsageIndicator.tsx/RateLimitIndicator.tsx: critical 95%, warning 91%, elevated 71%.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, ShieldCheck, AlertTriangle, LogIn } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { cn } from '../../lib/utils';
import { useUsageCostStore } from '../../stores/usage-cost-store';
import { formatTimeRemaining } from '../../../shared/utils/format-time';
import type { ProfileUsageSummary, ClaudeUsageSnapshot } from '../../../shared/types/agent';

/**
 * Usage threshold constants for color coding.
 * Kept in sync with UsageIndicator.tsx/RateLimitIndicator.tsx.
 */
const THRESHOLD_CRITICAL = 95; // Red: at or near limit
const THRESHOLD_WARNING = 91; // Orange: very high usage
const THRESHOLD_ELEVATED = 71; // Yellow: moderate usage
// Below 71 is considered normal (green)

/** Get progress-bar/badge color classes based on usage percentage. */
function getBadgeColorClasses(percent: number): string {
  if (percent >= THRESHOLD_CRITICAL) return 'text-red-500 bg-red-500/10 border-red-500/20';
  if (percent >= THRESHOLD_WARNING) return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
  if (percent >= THRESHOLD_ELEVATED) return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
  return 'text-green-500 bg-green-500/10 border-green-500/20';
}

/** Get the fill color class for the small usage progress bars. */
function getBarColorClass(percent: number): string {
  if (percent >= THRESHOLD_CRITICAL) return '[&>div]:bg-red-500';
  if (percent >= THRESHOLD_WARNING) return '[&>div]:bg-orange-500';
  if (percent >= THRESHOLD_ELEVATED) return '[&>div]:bg-yellow-500';
  return '[&>div]:bg-green-500';
}

/** Convert the detailed active-profile snapshot into the same shape used for the other profiles. */
function toSummary(snapshot: ClaudeUsageSnapshot): ProfileUsageSummary {
  return {
    profileId: snapshot.profileId,
    profileName: snapshot.profileName,
    profileEmail: snapshot.profileEmail,
    sessionPercent: snapshot.sessionPercent,
    weeklyPercent: snapshot.weeklyPercent,
    sessionResetTimestamp: snapshot.sessionResetTimestamp,
    weeklyResetTimestamp: snapshot.weeklyResetTimestamp,
    isAuthenticated: true,
    isRateLimited: false,
    availabilityScore: 100 - Math.max(snapshot.sessionPercent, snapshot.weeklyPercent),
    isActive: true,
    needsReauthentication: snapshot.needsReauthentication
  };
}

interface AccountRowProps {
  profile: ProfileUsageSummary;
}

function AccountRow({ profile }: AccountRowProps) {
  const { t } = useTranslation(['common']);
  const worstPercent = Math.max(profile.sessionPercent, profile.weeklyPercent);

  const sessionReset = formatTimeRemaining(profile.sessionResetTimestamp, t);
  const weeklyReset = formatTimeRemaining(profile.weeklyResetTimestamp, t);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{profile.profileName}</span>
          {profile.isActive && (
            <Badge variant="info" className="shrink-0">
              {t('common:usageCostDashboard.accountHeadroom.active')}
            </Badge>
          )}
          {profile.needsReauthentication && (
            <Badge variant="destructive" className="shrink-0 gap-1">
              <LogIn className="h-3 w-3" />
              {t('common:usageCostDashboard.accountHeadroom.needsReauth')}
            </Badge>
          )}
          {!profile.needsReauthentication && profile.isRateLimited && (
            <Badge variant="warning" className="shrink-0 gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('common:usageCostDashboard.accountHeadroom.rateLimited')}
            </Badge>
          )}
        </div>
        <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums', getBadgeColorClasses(worstPercent))}>
          {Math.round(worstPercent)}%
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('common:usageCostDashboard.accountHeadroom.session')}</span>
            <span className="tabular-nums">
              {Math.round(profile.sessionPercent)}%
              {sessionReset ? ` · ${sessionReset}` : ''}
            </span>
          </div>
          <Progress value={profile.sessionPercent} className={getBarColorClass(profile.sessionPercent)} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('common:usageCostDashboard.accountHeadroom.weekly')}</span>
            <span className="tabular-nums">
              {Math.round(profile.weeklyPercent)}%
              {weeklyReset ? ` · ${weeklyReset}` : ''}
            </span>
          </div>
          <Progress value={profile.weeklyPercent} className={getBarColorClass(profile.weeklyPercent)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Panel showing rate-limit/usage headroom for every configured account, plus which one
 * is currently active and whether any are rate-limited or need re-authentication (failover status).
 */
export function AccountHeadroomPanel() {
  const { t } = useTranslation(['common']);
  const accountHeadroom = useUsageCostStore((state) => state.accountHeadroom);

  const profiles = useMemo(() => {
    if (!accountHeadroom) return [];
    const active = toSummary(accountHeadroom.activeProfile);
    const others = accountHeadroom.allProfiles.filter((p) => p.profileId !== active.profileId);
    return [active, ...others];
  }, [accountHeadroom]);

  const hasRateLimitedAccount = profiles.some((p) => p.isRateLimited || p.needsReauthentication);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {hasRateLimitedAccount ? (
            <AlertTriangle className="h-4 w-4 text-warning" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          )}
          {t('common:usageCostDashboard.accountHeadroom.title')}
        </CardTitle>
        <CardDescription>{t('common:usageCostDashboard.accountHeadroom.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {profiles.length > 0 ? (
          <div className="space-y-2">
            {profiles.map((profile) => (
              <AccountRow key={profile.profileId} profile={profile} />
            ))}
          </div>
        ) : (
          <div className="flex h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Users className="h-5 w-5" />
            {t('common:usageCostDashboard.accountHeadroom.empty')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
