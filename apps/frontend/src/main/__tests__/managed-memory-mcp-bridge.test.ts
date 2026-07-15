import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectStore } from '../project-store';
import { ManagedMemoryMcpBridge } from '../managed-memory-mcp-bridge';

describe('ManagedMemoryMcpBridge', () => {
  const bridges: ManagedMemoryMcpBridge[] = [];

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
    vi.restoreAllMocks();
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
    const transport = new StreamableHTTPClientTransport(new URL(url!));
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
});
