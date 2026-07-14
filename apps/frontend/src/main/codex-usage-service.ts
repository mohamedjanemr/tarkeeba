import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  CodexUsageResult,
  CodexUsageUnavailableReason,
  CodexUsageWindow,
  OpenAIProfile,
} from '../shared/types';
import { getAugmentedEnv } from './env-utils';
import { getOpenAIProfileManager } from './openai-profile-manager';

const DEFAULT_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30_000;

type JsonRecord = Record<string, unknown>;
type LaunchAppServer = (env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null;

function unavailable(
  profile: OpenAIProfile | undefined,
  reason: CodexUsageUnavailableReason,
  message: string
): CodexUsageResult {
  return {
    status: 'unavailable',
    profileId: profile?.id,
    profileName: profile?.name,
    fetchedAt: new Date().toISOString(),
    reason,
    message,
  };
}

function normalizeWindow(
  value: unknown,
  kind: CodexUsageWindow['kind']
): CodexUsageWindow | undefined {
  if (!isRecord(value)) return undefined;

  const used = value.usedPercent ?? value.used_percent;
  if (typeof used !== 'number' || !Number.isFinite(used)) return undefined;

  const duration = value.windowDurationMins ?? value.window_duration_mins;
  const rawReset = value.resetsAt ?? value.resets_at;
  const resetDate = typeof rawReset === 'number'
    ? new Date(rawReset > 1e12 ? rawReset : rawReset * 1000)
    : typeof rawReset === 'string'
      ? new Date(rawReset)
      : undefined;

  return {
    kind,
    percentUsed: Math.max(0, Math.min(100, used)),
    ...(typeof duration === 'number' && Number.isFinite(duration)
      ? { durationMinutes: duration }
      : {}),
    ...(resetDate && !Number.isNaN(resetDate.getTime())
      ? { resetAt: resetDate.toISOString() }
      : {}),
  };
}

export function normalizeCodexRateLimits(payload: unknown): CodexUsageWindow[] {
  if (!isRecord(payload)) return [];

  let limits: unknown = payload.rateLimits ?? payload.rate_limits;
  if (!isRecord(limits)) {
    const byId = payload.rateLimitsByLimitId ?? payload.rate_limits_by_limit_id;
    if (isRecord(byId)) {
      limits = byId.codex ?? Object.values(byId).find(isRecord);
    }
  }
  if (!isRecord(limits)) return [];

  const primary = normalizeWindow(limits.primary, 'primary');
  const secondary = normalizeWindow(limits.secondary, 'secondary');
  return [primary, secondary].filter((window): window is CodexUsageWindow => Boolean(window));
}

/** Queries one managed Codex profile without reading the global CODEX_HOME. */
export class CodexUsageService {
  private readonly cache = new Map<string, { expiresAt: number; result: CodexUsageResult }>();

  constructor(
    private readonly resolveProfile = (id?: string) => getOpenAIProfileManager().getProfile(id),
    private readonly launch: LaunchAppServer = (env) =>
      spawn('codex', ['app-server'], { env, stdio: 'pipe', windowsHide: true }),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {}

  async getUsage(profileId?: string, forceRefresh = false): Promise<CodexUsageResult> {
    let profile: OpenAIProfile | undefined;
    try {
      profile = this.resolveProfile(profileId);
    } catch {
      return unavailable(undefined, 'unavailable', 'Codex usage is temporarily unavailable.');
    }

    if (!profile) return unavailable(undefined, 'no-profile', 'No Codex account is selected.');
    if (!profile.isAuthenticated) {
      return unavailable(profile, 'not-authenticated', 'This Codex account is not signed in.');
    }

    const cached = this.cache.get(profile.id);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.result;

    const env = { ...getAugmentedEnv(), CODEX_HOME: profile.codexHome };
    try {
      const response = await this.query(env);
      const windows = normalizeCodexRateLimits(response);
      if (windows.length === 0) {
        return unavailable(
          profile,
          'no-rate-limits',
          'This Codex account did not provide usage-limit data.'
        );
      }

      const result: CodexUsageResult = {
        status: 'available',
        snapshot: {
          profileId: profile.id,
          profileName: profile.name,
          fetchedAt: new Date().toISOString(),
          windows,
        },
      };
      this.cache.set(profile.id, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'unsupported';
      const reason: CodexUsageUnavailableReason = code === 'timeout'
        ? 'timeout'
        : code === 'malformed-response'
          ? 'malformed-response'
          : 'unsupported';
      return unavailable(
        profile,
        reason,
        reason === 'timeout'
          ? 'Codex usage request timed out.'
          : 'Codex usage is unavailable from this CLI or account.'
      );
    }
  }

  private query(env: NodeJS.ProcessEnv): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.launch(env);
      } catch {
        reject(new Error('launch-failed'));
        return;
      }

      let buffer = '';
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('timeout')), this.timeoutMs);

      const send = (message: JsonRecord) => {
        try {
          child.stdin.write(`${JSON.stringify(message)}\n`);
        } catch {
          finish(new Error('launch-failed'));
        }
      };

      child.once('error', () => finish(new Error('launch-failed')));
      child.once('exit', () => finish(new Error('launch-failed')));
      child.stdout.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;

          let response: JsonRecord;
          try {
            const parsed = JSON.parse(line) as unknown;
            if (!isRecord(parsed)) throw new Error('invalid');
            response = parsed;
          } catch {
            finish(new Error('malformed-response'));
            return;
          }

          if (response.id === 1) {
            if (!isRecord(response.result)) {
              finish(new Error('malformed-response'));
              return;
            }
            send({ jsonrpc: '2.0', method: 'initialized', params: {} });
            send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null });
          } else if (response.id === 2) {
            if (response.error || !isRecord(response.result)) {
              finish(new Error('unsupported'));
              return;
            }
            finish(undefined, response.result);
          }
        }
      });

      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'tarkeeba', title: 'Tarkeeba', version: '1' },
          capabilities: null,
        },
      });
    });
  }
}

let service: CodexUsageService | undefined;

export function getCodexUsageService(): CodexUsageService {
  service ??= new CodexUsageService();
  return service;
}
