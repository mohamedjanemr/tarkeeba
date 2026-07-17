import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubFetch } from '../utils';

describe('githubFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts successful GitHub endpoints with an empty 204 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(null, { status: 204 })
    ));

    await expect(
      githubFetch('token', '/repos/owner/repo/actions/runs/1/rerun-failed-jobs', {
        method: 'POST'
      })
    ).resolves.toBeNull();
  });

  it('parses JSON responses normally', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    ));

    await expect(githubFetch('token', '/user')).resolves.toEqual({ ok: true });
  });
});
