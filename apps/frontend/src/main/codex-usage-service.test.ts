import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { OpenAIProfile } from '../shared/types';
import { CodexUsageService, normalizeCodexRateLimits } from './codex-usage-service';

function createProfile(overrides: Partial<OpenAIProfile> = {}): OpenAIProfile {
  return {
    id: 'openai-test',
    name: 'Codex Test',
    codexHome: '/profiles/codex-test',
    isAuthenticated: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createAppServer(
  rateLimits: unknown,
  requests: Array<Record<string, unknown>> = []
) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  let input = '';
  child.stdin.on('data', (chunk: Buffer) => {
    input += chunk.toString();
    for (;;) {
      const newline = input.indexOf('\n');
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      const request = JSON.parse(line) as Record<string, unknown>;
      requests.push(request);
      if (request.id === 1) {
        child.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
      } else if (request.id === 2) {
        child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, result: rateLimits })}\n`);
      }
    }
  });
  return child as never;
}

describe('normalizeCodexRateLimits', () => {
  it('normalizes and bounds current app-server quota windows', () => {
    expect(normalizeCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 120, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: -3, windowDurationMins: 10_080 },
      },
    })).toEqual([
      {
        kind: 'primary',
        percentUsed: 100,
        durationMinutes: 300,
        resetAt: '2027-01-15T08:00:00.000Z',
      },
      { kind: 'secondary', percentUsed: 0, durationMinutes: 10_080 },
    ]);
  });

  it('supports snake_case and the multi-bucket response', () => {
    expect(normalizeCodexRateLimits({
      rate_limits_by_limit_id: {
        codex: { primary: { used_percent: 25, window_duration_mins: 300 } },
      },
    })).toEqual([{ kind: 'primary', percentUsed: 25, durationMinutes: 300 }]);
  });

  it('rejects malformed windows', () => {
    expect(normalizeCodexRateLimits({
      rateLimits: { primary: { usedPercent: '90' }, secondary: null },
    })).toEqual([]);
  });
});

describe('CodexUsageService', () => {
  it('uses the selected profile home and the current protocol handshake', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const launchedEnvironments: NodeJS.ProcessEnv[] = [];
    const service = new CodexUsageService(
      () => createProfile(),
      (env) => {
        launchedEnvironments.push(env);
        return createAppServer({
          rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300 } },
        }, requests);
      }
    );

    await expect(service.getUsage('openai-test')).resolves.toMatchObject({
      status: 'available',
      snapshot: {
        profileId: 'openai-test',
        windows: [{ kind: 'primary', percentUsed: 42 }],
      },
    });
    expect(launchedEnvironments[0]?.CODEX_HOME).toBe('/profiles/codex-test');
    expect(requests).toContainEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'account/rateLimits/read',
      params: null,
    });
    expect(requests).toContainEqual({ jsonrpc: '2.0', method: 'initialized', params: {} });
  });

  it('caches successful results unless a refresh is forced', async () => {
    const launch = vi.fn(() => createAppServer({
      rateLimits: { primary: { usedPercent: 10 } },
    }));
    const service = new CodexUsageService(() => createProfile(), launch);

    await service.getUsage();
    await service.getUsage();
    await service.getUsage(undefined, true);

    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('returns actionable states for missing and signed-out profiles', async () => {
    await expect(new CodexUsageService(() => undefined).getUsage()).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'no-profile',
    });
    await expect(new CodexUsageService(
      () => createProfile({ isAuthenticated: false })
    ).getUsage()).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'not-authenticated',
    });
  });

  it('returns timeout and malformed-response states without rejecting', async () => {
    const silentServer = () => Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    }) as never;
    const malformedServer = () => {
      const child = silentServer() as unknown as {
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.stdin.once('data', () => child.stdout.write('not-json\n'));
      return child as never;
    };

    await expect(new CodexUsageService(
      () => createProfile(),
      silentServer,
      5
    ).getUsage()).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
    await expect(new CodexUsageService(
      () => createProfile(),
      malformedServer
    ).getUsage()).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'malformed-response',
    });
  });
});
