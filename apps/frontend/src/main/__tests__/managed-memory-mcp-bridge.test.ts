import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectStore } from '../project-store';
import * as memoryServiceModule from '../memory-service';
import {
  ManagedMemoryMcpBridge,
  computeProjectMemoryGroupId
} from '../managed-memory-mcp-bridge';

describe('ManagedMemoryMcpBridge', () => {
  const bridges: ManagedMemoryMcpBridge[] = [];

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
    vi.restoreAllMocks();
  });

  it('uses the canonical path-derived project memory namespace', () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'memory-project-'));
    try {
      const resolvedPath = realpathSync.native(projectDir);
      const hash = createHash('md5').update(resolvedPath).digest('hex').slice(0, 8);

      expect(computeProjectMemoryGroupId(projectDir)).toBe(
        `project_${path.basename(resolvedPath)}_${hash}`
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('binds to an OS-assigned loopback port and reports health', async () => {
    const bridge = new ManagedMemoryMcpBridge();
    bridges.push(bridge);

    const status = await bridge.start();

    expect(status.running).toBe(true);
    expect(status.port).toBeGreaterThan(0);
    expect(status.baseUrl).toBe(`http://127.0.0.1:${status.port}`);

    const response = await fetch(`${status.baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'tarkeeba-memory-mcp'
    });
  });

  it('returns a project-scoped MCP URL only while running', async () => {
    const bridge = new ManagedMemoryMcpBridge();
    bridges.push(bridge);

    expect(bridge.getProjectUrl('project one')).toBeNull();
    const status = await bridge.start();
    expect(bridge.getProjectUrl('project one')).toBe(
      `${status.baseUrl}/mcp/project%20one`
    );

    await bridge.stop();
    expect(bridge.getProjectUrl('project one')).toBeNull();
  });

  it('serves the Graphiti-compatible memory tool contract over MCP', async () => {
    vi.spyOn(projectStore, 'getProject').mockReturnValue({
      id: 'test-project',
      name: 'Test Project',
      path: process.cwd(),
      autoBuildPath: process.cwd(),
      settings: {
        graphitiMcpEnabled: true,
        graphitiMcpMode: 'managed'
      }
    } as ReturnType<typeof projectStore.getProject>);

    const bridge = new ManagedMemoryMcpBridge();
    bridges.push(bridge);
    await bridge.start();

    const url = bridge.getProjectUrl('test-project');
    expect(url).not.toBeNull();
    if (!url) throw new Error('Expected managed memory MCP URL');
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: 'tarkeeba-memory-test', version: '1.0.0' });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      expect(result.tools.map((tool) => tool.name)).toEqual([
        'search_nodes',
        'search_facts',
        'add_episode',
        'get_episodes',
        'get_entity_edge'
      ]);
    } finally {
      await transport.close();
    }
  });

  it('scopes managed MCP reads, searches, and writes to the project path', async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'managed-memory-project-'));
    const searchMemoriesSemantic = vi.fn().mockResolvedValue({
      memories: [],
      searchType: 'keyword'
    });
    const addEpisode = vi.fn().mockResolvedValue({ success: true, id: 'episode-1' });
    const browseEpisodes = vi.fn().mockResolvedValue([]);
    const browseEntities = vi.fn().mockResolvedValue([]);

    vi.spyOn(memoryServiceModule, 'getMemoryService').mockReturnValue({
      searchMemoriesSemantic,
      addEpisode,
      browseEpisodes,
      browseEntities
    } as unknown as ReturnType<typeof memoryServiceModule.getMemoryService>);
    vi.spyOn(projectStore, 'getProject').mockReturnValue({
      id: 'test-project',
      name: 'Test Project',
      path: projectDir,
      autoBuildPath: '.auto-claude',
      settings: {
        graphitiMcpEnabled: true,
        graphitiMcpMode: 'managed'
      }
    } as ReturnType<typeof projectStore.getProject>);

    const bridge = new ManagedMemoryMcpBridge();
    bridges.push(bridge);
    await bridge.start();

    const projectUrl = bridge.getProjectUrl('test-project');
    if (!projectUrl) throw new Error('Expected managed memory MCP URL');
    const transport = new StreamableHTTPClientTransport(new URL(projectUrl));
    const client = new Client({ name: 'tarkeeba-memory-test', version: '1.0.0' });

    try {
      await client.connect(transport);
      await client.callTool({
        name: 'search_nodes',
        arguments: { query: 'authentication', max_nodes: 5 }
      });
      await client.callTool({
        name: 'add_episode',
        arguments: {
          name: 'Scoped memory',
          episode_body: 'Remember this',
          group_id: 'another-project'
        }
      });
      await client.callTool({
        name: 'get_episodes',
        arguments: { last_n: 7 }
      });

      expect(searchMemoriesSemantic).toHaveBeenCalledWith(
        'authentication',
        expect.any(Object),
        5,
        projectDir
      );
      expect(addEpisode).toHaveBeenCalledWith(
        'Scoped memory',
        'Remember this',
        'session_insight',
        computeProjectMemoryGroupId(projectDir)
      );
      expect(browseEpisodes).toHaveBeenCalledWith(projectDir, 7);
    } finally {
      await transport.close();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
