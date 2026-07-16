import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Request, Response } from 'express';
import { z } from 'zod/v4';
import { projectStore } from './project-store';
import { getMemoryService, type EmbedderConfig } from './memory-service';
import { buildMemoryEnvVars } from './memory-env-builder';
import { readSettingsFile } from './settings-utils';
import type { AppSettings } from '../shared/types/settings';
import {
  getGraphitiDatabaseDetails,
  loadProjectEnvVars
} from './ipc-handlers/context/utils';
import { setManagedMemoryMcpBaseUrl } from './managed-memory-mcp-state';

const LOOPBACK_HOST = '127.0.0.1';

export interface ManagedMemoryMcpStatus {
  running: boolean;
  port?: number;
  baseUrl?: string;
  error?: string;
}

function buildEmbedderConfig(env: Record<string, string>): EmbedderConfig {
  const provider = (env.GRAPHITI_EMBEDDER_PROVIDER || 'ollama') as EmbedderConfig['provider'];
  return {
    provider,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
    googleApiKey: env.GOOGLE_API_KEY,
    googleEmbeddingModel: env.GOOGLE_EMBEDDING_MODEL,
    ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaEmbeddingModel: env.OLLAMA_EMBEDDING_MODEL,
    ollamaEmbeddingDim: env.OLLAMA_EMBEDDING_DIM
      ? Number.parseInt(env.OLLAMA_EMBEDDING_DIM, 10)
      : undefined,
    voyageApiKey: env.VOYAGE_API_KEY,
    voyageEmbeddingModel: env.VOYAGE_EMBEDDING_MODEL,
    azureOpenaiApiKey: env.AZURE_OPENAI_API_KEY,
    azureOpenaiBaseUrl: env.AZURE_OPENAI_BASE_URL,
    azureOpenaiEmbeddingDeployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT
  };
}

function jsonContent(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Match the canonical project namespace used by GraphitiMemory and
 * query_memory.py so managed MCP writes are visible in the project browser.
 */
export function computeProjectMemoryGroupId(projectDir: string): string {
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync.native(projectDir);
  } catch {
    resolvedPath = path.resolve(projectDir);
  }

  const projectName = path.basename(resolvedPath);
  const pathHash = createHash('md5').update(resolvedPath).digest('hex').slice(0, 8);
  return `project_${projectName}_${pathHash}`;
}

function createProjectMemoryServer(projectId: string): McpServer {
  const project = projectStore.getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const appSettings = (readSettingsFile() || {}) as Partial<AppSettings>;
  const appEnv = buildMemoryEnvVars(appSettings as AppSettings);
  const projectEnv = loadProjectEnvVars(project.path, project.autoBuildPath);
  const effectiveEnv = { ...appEnv, ...projectEnv };
  const database = getGraphitiDatabaseDetails(effectiveEnv);
  const memory = getMemoryService(database);
  const embedder = buildEmbedderConfig(effectiveEnv);
  const projectGroupId = computeProjectMemoryGroupId(project.path);

  const server = new McpServer({
    name: 'tarkeeba-memory',
    version: '1.0.0'
  });

  server.registerTool(
    'search_nodes',
    {
      description: 'Search Tarkeeba project memory using local semantic embeddings.',
      inputSchema: {
        query: z.string().min(1),
        max_nodes: z.number().int().min(1).max(100).optional(),
        group_ids: z.array(z.string()).optional()
      }
    },
    async ({ query, max_nodes }) => {
      const result = await memory.searchMemoriesSemantic(
        query,
        embedder,
        max_nodes ?? 20,
        project.path
      );
      return jsonContent({ nodes: result.memories, search_type: result.searchType });
    }
  );

  server.registerTool(
    'search_facts',
    {
      description: 'Search facts and relevant memories in the current Tarkeeba project.',
      inputSchema: {
        query: z.string().min(1),
        max_facts: z.number().int().min(1).max(100).optional(),
        group_ids: z.array(z.string()).optional()
      }
    },
    async ({ query, max_facts }) => {
      const result = await memory.searchMemoriesSemantic(
        query,
        embedder,
        max_facts ?? 20,
        project.path
      );
      return jsonContent({ facts: result.memories, search_type: result.searchType });
    }
  );

  server.registerTool(
    'add_episode',
    {
      description: 'Add a durable episode to the current Tarkeeba project memory.',
      inputSchema: {
        name: z.string().min(1),
        episode_body: z.union([z.string(), z.record(z.string(), z.unknown())]),
        source: z.string().optional(),
        source_description: z.string().optional(),
        group_id: z.string().optional()
      }
    },
    async ({ name, episode_body }) => {
      const result = await memory.addEpisode(
        name,
        episode_body,
        'session_insight',
        projectGroupId
      );
      return jsonContent(result);
    }
  );

  server.registerTool(
    'get_episodes',
    {
      description: 'Get the most recent episodes from the current Tarkeeba project memory.',
      inputSchema: {
        last_n: z.number().int().min(1).max(100).optional(),
        group_ids: z.array(z.string()).optional()
      }
    },
    async ({ last_n }) => jsonContent({
      episodes: await memory.browseEpisodes(project.path, last_n ?? 20)
    })
  );

  server.registerTool(
    'get_entity_edge',
    {
      description: 'Retrieve one stored memory by its identifier.',
      inputSchema: { uuid: z.string().min(1) }
    },
    async ({ uuid }) => {
      const [episodes, entities] = await Promise.all([
        memory.browseEpisodes(project.path, 100),
        memory.browseEntities(project.path, 100)
      ]);
      return jsonContent({
        entity_edge:
          episodes.find((item) => item.id === uuid) ??
          entities.find((item) => item.id === uuid) ??
          null
      });
    }
  );

  return server;
}

export class ManagedMemoryMcpBridge {
  private httpServer: Server | null = null;
  private status: ManagedMemoryMcpStatus = { running: false };

  async start(): Promise<ManagedMemoryMcpStatus> {
    if (this.httpServer && this.status.running) return this.status;

    const expressApp = createMcpExpressApp({ host: LOOPBACK_HOST });

    expressApp.get('/health', (_request: Request, response: Response) => {
      response.json({ status: 'ok', service: 'tarkeeba-memory-mcp' });
    });

    expressApp.post('/mcp/:projectId', async (request: Request, response: Response) => {
      let server: McpServer | null = null;
      let transport: StreamableHTTPServerTransport | null = null;
      try {
        const projectId = Array.isArray(request.params.projectId)
          ? request.params.projectId[0]
          : request.params.projectId;
        server = createProjectMemoryServer(projectId);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        });
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
      } catch (error) {
        if (!response.headersSent) {
          response.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Memory MCP request failed'
            },
            id: null
          });
        }
      } finally {
        await transport?.close().catch(() => undefined);
        await server?.close().catch(() => undefined);
      }
    });

    expressApp.all('/mcp/:projectId', (_request: Request, response: Response) => {
      response.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null
      });
    });

    try {
      const httpServer = await new Promise<Server>((resolve, reject) => {
        const candidate = expressApp.listen(0, LOOPBACK_HOST, () => resolve(candidate));
        candidate.once('error', reject);
      });
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        httpServer.close();
        throw new Error('Unable to determine managed MCP port');
      }

      const baseUrl = `http://${LOOPBACK_HOST}:${address.port}`;
      this.httpServer = httpServer;
      this.status = {
        running: true,
        port: address.port,
        baseUrl
      };
      setManagedMemoryMcpBaseUrl(baseUrl);
    } catch (error) {
      setManagedMemoryMcpBaseUrl(null);
      this.status = {
        running: false,
        error: error instanceof Error ? error.message : 'Failed to start managed memory MCP bridge'
      };
    }

    return this.status;
  }

  getStatus(): ManagedMemoryMcpStatus {
    return { ...this.status };
  }

  getProjectUrl(projectId: string): string | null {
    if (!this.status.running || !this.status.baseUrl) return null;
    return `${this.status.baseUrl}/mcp/${encodeURIComponent(projectId)}`;
  }

  async stop(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = null;
    this.status = { running: false };
    setManagedMemoryMcpBaseUrl(null);
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export const managedMemoryMcpBridge = new ManagedMemoryMcpBridge();
