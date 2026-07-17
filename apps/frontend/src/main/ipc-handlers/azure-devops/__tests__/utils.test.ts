import { afterEach, describe, expect, it, vi } from 'vitest';
import { azureDevOpsFetch } from '../utils';

describe('azureDevOpsFetch URL construction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['/projects/demo', 'https://dev.azure.com/org/_apis/projects/demo'],
    ['/_apis/projects', 'https://dev.azure.com/org/_apis/projects'],
    ['/Demo/_apis/wit/wiql', 'https://dev.azure.com/org/Demo/_apis/wit/wiql']
  ])('builds the expected URL for %s', async (endpoint, expectedUrl) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ value: [] })
    });
    vi.stubGlobal('fetch', fetchMock);

    await azureDevOpsFetch('test-pat', 'org', endpoint);

    expect(fetchMock).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) })
    }));
  });
});
