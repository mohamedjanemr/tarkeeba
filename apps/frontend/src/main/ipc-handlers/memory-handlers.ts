/**
 * Memory Infrastructure IPC Handlers
 *
 * Provides memory database status and validation for the Graphiti integration.
 * Uses LadybugDB (embedded Kuzu-based database) - no Docker required.
 */

import { ipcMain, app } from 'electron';
import { spawn, execFileSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import { getOllamaExecutablePaths, getOllamaInstallCommand as getPlatformOllamaInstallCommand, getWhichCommand, getCurrentOS } from '../platform';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { IPC_CHANNELS, getSpecsDir } from '../../shared/constants';
import type {
  IPCResult,
  InfrastructureStatus,
  GraphitiValidationResult,
  GraphitiConnectionTestResult,
  MemoryEntity,
  MemoryRelationship,
  MemoryTimelineEntry,
  MemoryEpisode,
  MemoryKind,
} from '../../shared/types';
import {
  getMemoryServiceStatus,
  getMemoryService,
  getDefaultDbPath,
  isKuzuAvailable,
} from '../memory-service';
import type { MemoryService, MemoryUpdatePayload } from '../memory-service';
import { validateOpenAIApiKey } from '../api-validation-service';
import { parsePythonCommand } from '../python-detector';
import { getConfiguredPythonPath, pythonEnvManager } from '../python-env-manager';
import { openTerminalWithCommand } from './claude-code-handlers';
import { managedMemoryMcpBridge } from '../managed-memory-mcp-bridge';
import { projectStore } from '../project-store';
import { buildMemoryEnvVars } from '../memory-env-builder';
import { readSettingsFile } from '../settings-utils';
import type { AppSettings } from '../../shared/types/settings';
import { loadFileBasedMemories } from './context/memory-data-handlers';
import {
  loadProjectEnvVars,
  isGraphitiEnabled,
  getGraphitiDatabaseDetails,
} from './context/utils';

/**
 * Ollama Service Status
 * Contains information about Ollama service availability and configuration
 */
interface OllamaStatus {
  running: boolean;      // Whether Ollama service is currently running
  url: string;          // Base URL of the Ollama API
  version?: string;     // Ollama version (if available)
  message?: string;     // Additional status message
}

/**
 * Ollama Model Information
 * Metadata about a model available in Ollama
 */
interface OllamaModel {
  name: string;         // Model identifier (e.g., 'embeddinggemma', 'llama2')
  size_bytes: number;   // Model size in bytes
  size_gb: number;      // Model size in gigabytes (formatted)
  modified_at: string;  // Last modified timestamp
  is_embedding: boolean; // Whether this is an embedding model
  embedding_dim?: number | null; // Embedding dimension (only for embedding models)
  description?: string; // Model description
}

/**
 * Ollama Embedding Model Information
 * Specialized model info for semantic search models
 */
interface OllamaEmbeddingModel {
  name: string;             // Model name
  embedding_dim: number | null; // Embedding vector dimension
  description: string;      // Model description
  size_bytes: number;
  size_gb: number;
}

/**
 * Recommended Embedding Model Card
 * Pre-curated models suitable for Tarkeeba memory system
 */
interface OllamaRecommendedModel {
  name: string;          // Model identifier
  description: string;   // Human-readable description
  size_estimate: string; // Estimated download size (e.g., '621 MB')
  dim: number;           // Embedding vector dimension
  installed: boolean;    // Whether model is currently installed
}

/**
 * Result of ollama pull command
 * Contains the final status after model download completes
 */
interface OllamaPullResult {
  model: string;                         // Model name that was pulled
  status: 'completed' | 'failed';        // Final status
  output: string[];                      // Log messages from pull operation
}

/**
 * Ollama Installation Status
 * Information about whether Ollama is installed on the system
 */
interface OllamaInstallStatus {
  installed: boolean;         // Whether Ollama binary is found on the system
  path?: string;             // Path to Ollama binary (if found)
  version?: string;          // Installed version (if available)
}

/**
 * Check if Ollama is installed on the system by looking for the binary.
 * Checks common installation paths and PATH environment variable.
 *
 * @returns {OllamaInstallStatus} Installation status with path if found
 */
function checkOllamaInstalled(): OllamaInstallStatus {
  // Get platform-specific paths from the platform module
  const pathsToCheck = getOllamaExecutablePaths();

  // Check each path
  // SECURITY NOTE: ollamaPath values come from the platform module's hardcoded paths,
  // not from user input or environment variables. These are known system installation paths.
  for (const ollamaPath of pathsToCheck) {
    if (fs.existsSync(ollamaPath)) {
      // Try to get version - use execFileSync to avoid shell injection
      let version: string | undefined;
      try {
        const versionOutput = execFileSync(ollamaPath, ['--version'], {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).toString().trim();
        // Parse version from output like "ollama version 0.1.23"
        const match = versionOutput.match(/(\d+\.\d+\.\d+)/);
        if (match) {
          version = match[1];
        }
      } catch {
        // Couldn't get version, but binary exists
      }

      return {
        installed: true,
        path: ollamaPath,
        version,
      };
    }
  }

  // Also check if ollama is in PATH using where/which command
  // Use execFileSync with explicit command to avoid shell injection
  try {
    const whichCmd = getWhichCommand();
    const ollamaPath = execFileSync(whichCmd, ['ollama'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).toString().trim().split('\n')[0]; // Get first result on Windows

    if (ollamaPath && fs.existsSync(ollamaPath)) {
      let version: string | undefined;
      try {
        // Use the discovered path directly with execFileSync
        const versionOutput = execFileSync(ollamaPath, ['--version'], {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).toString().trim();
        const match = versionOutput.match(/(\d+\.\d+\.\d+)/);
        if (match) {
          version = match[1];
        }
      } catch {
        // Couldn't get version
      }

      return {
        installed: true,
        path: ollamaPath,
        version,
      };
    }
  } catch {
    // Not in PATH
  }

  return { installed: false };
}

/**
 * Get the platform-specific install command for Ollama
 * Uses the official Ollama installation methods from the platform module.
 *
 * Windows: Uses winget (Windows Package Manager)
 * macOS: Uses Homebrew
 * Linux: Uses official install script from https://ollama.com/download
 *
 * @returns {string} The install command to run in terminal
 */
function getOllamaInstallCommand(): string {
  return getPlatformOllamaInstallCommand();
}

/**
 * Execute the ollama_model_detector.py Python script.
 * Spawns a subprocess to run Ollama detection/management commands with a 10-second timeout.
 * Used to check Ollama status, list models, and manage downloads.
 *
 * Includes deduplication: identical command+baseUrl requests within 2s return the cached
 * result/promise instead of spawning a new subprocess. This prevents runaway subprocess
 * spawning from React re-render loops.
 *
 * Supported commands:
 * - 'check-status': Verify Ollama service is running
 * - 'list-models': Get all available models
 * - 'list-embedding-models': Get only embedding models
 * - 'pull-model': Download a specific model (see OLLAMA_PULL_MODEL handler for full implementation)
 *
 * @async
 * @param {string} command - The command to execute (check-status, list-models, list-embedding-models, pull-model)
 * @param {string} [baseUrl] - Optional Ollama API base URL (defaults to http://localhost:11434)
 * @returns {Promise<{success, data?, error?}>} Result object with success flag and data/error
 */
// Deduplication cache to prevent rapid-fire subprocess spawning (e.g., from React re-render loops)
const ollamaDetectorCache = new Map<string, { promise: Promise<{ success: boolean; data?: unknown; error?: string }>; timestamp: number }>();
const OLLAMA_CACHE_TTL_MS = 2000; // Cache results for 2 seconds

async function executeOllamaDetector(
  command: string,
  baseUrl?: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // Deduplication: return cached promise for identical requests within TTL
  const cacheKey = `${command}:${baseUrl || 'default'}`;
  const cached = ollamaDetectorCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < OLLAMA_CACHE_TTL_MS) {
    if (process.env.DEBUG) {
      console.log('[OllamaDetector] Returning cached result for:', command);
    }
    return cached.promise;
  }

  const promise = executeOllamaDetectorImpl(command, baseUrl);
  ollamaDetectorCache.set(cacheKey, { promise, timestamp: Date.now() });

  // Clean up cache entry after TTL
  promise.finally(() => {
    setTimeout(() => {
      const entry = ollamaDetectorCache.get(cacheKey);
      if (entry && entry.promise === promise) {
        ollamaDetectorCache.delete(cacheKey);
      }
    }, OLLAMA_CACHE_TTL_MS);
  });

  return promise;
}

async function executeOllamaDetectorImpl(
  command: string,
  baseUrl?: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // Use configured Python path (venv if ready, otherwise bundled/system)
  // Note: ollama_model_detector.py doesn't require dotenv, but using venv is safer
  const pythonCmd = getConfiguredPythonPath();

  // Find the ollama_model_detector.py script
  const possiblePaths = [
    // Packaged app paths (check FIRST for packaged builds)
    ...(app.isPackaged
      ? [path.join(process.resourcesPath, 'backend', 'ollama_model_detector.py')]
      : []),
    // Development paths
    path.resolve(__dirname, '..', '..', '..', 'backend', 'ollama_model_detector.py'),
    path.resolve(process.cwd(), 'apps', 'backend', 'ollama_model_detector.py')
  ];

  let scriptPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      scriptPath = p;
      break;
    }
  }

  if (!scriptPath) {
    if (process.env.DEBUG) {
      console.error(
        '[OllamaDetector] Python script not found. Searched paths:',
        possiblePaths
      );
    }
    return { success: false, error: 'ollama_model_detector.py script not found' };
  }

  if (process.env.DEBUG) {
    console.log('[OllamaDetector] Using script at:', scriptPath);
  }

  const [pythonExe, baseArgs] = parsePythonCommand(pythonCmd);
  const args = [...baseArgs, scriptPath, command];
  if (baseUrl) {
    args.push('--base-url', baseUrl);
  }

  return new Promise((resolve) => {
    let resolved = false;
    const proc = spawn(pythonExe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Use sanitized Python environment to prevent PYTHONHOME contamination
      // Fixes "Could not find platform independent libraries" error on Windows
      env: pythonEnvManager.getPythonEnv(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8');
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
    });

    // Single timeout mechanism to avoid race condition
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({ success: false, error: 'Timeout' });
      }
    }, 10000);

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      if (code === 0 && stdout) {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ success: false, error: `Invalid JSON: ${stdout}` });
        }
      } else {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Register all memory-related IPC handlers.
 * Sets up handlers for:
 * - Memory infrastructure status and management
 * - Graphiti LLM/Embedding provider validation
 * - Ollama model discovery and downloads with real-time progress tracking
 *
 * These handlers allow the renderer process to:
 * 1. Check memory system status (Kuzu database, LadybugDB)
 * 2. Validate API keys for LLM and embedding providers
 * 3. Discover, list, and download Ollama models
 * 4. Subscribe to real-time download progress events
 *
 * @returns {void}
 */
export function registerMemoryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MEMORY_MCP_STATUS, async () => {
    const currentStatus = managedMemoryMcpBridge.getStatus();
    return {
      success: true,
      data: currentStatus.running
        ? currentStatus
        : await managedMemoryMcpBridge.start()
    };
  });

  // Get memory infrastructure status
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_STATUS,
    async (_): Promise<IPCResult<InfrastructureStatus>> => {
      try {
        const status = getMemoryServiceStatus();
        return {
          success: true,
          data: {
            memory: status,
            ready: status.kuzuInstalled && status.databaseExists,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check memory status',
        };
      }
    }
  );

  // List available databases
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_LIST_DATABASES,
    async (_, dbPath?: string): Promise<IPCResult<string[]>> => {
      try {
        const status = getMemoryServiceStatus(dbPath);
        return { success: true, data: status.databases };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list databases',
        };
      }
    }
  );

  // Test memory database connection
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_TEST_CONNECTION,
    async (_, dbPath?: string, database?: string): Promise<IPCResult<GraphitiValidationResult>> => {
      try {
        if (!isKuzuAvailable()) {
          return {
            success: true,
            data: {
              success: false,
              message: 'kuzu-node is not installed. Memory features require Python 3.12+ with LadybugDB.',
            },
          };
        }

        const service = getMemoryService({
          dbPath: dbPath || getDefaultDbPath(),
          database: database || 'auto_claude_memory',
        });

        const result = await service.testConnection();
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test connection',
        };
      }
    }
  );

  // ============================================
  // Graphiti Validation Handlers
  // ============================================

  // Validate LLM provider API key (OpenAI, Anthropic, etc.)
  ipcMain.handle(
    IPC_CHANNELS.GRAPHITI_VALIDATE_LLM,
    async (_, provider: string, apiKey: string): Promise<IPCResult<GraphitiValidationResult>> => {
      try {
        // For now, we only validate OpenAI - other providers can be added later
        if (provider === 'openai') {
          const result = await validateOpenAIApiKey(apiKey);
          return { success: true, data: result };
        }

        // For other providers, do basic validation
        if (!apiKey || !apiKey.trim()) {
          return {
            success: true,
            data: {
              success: false,
              message: 'API key is required',
            },
          };
        }

        return {
          success: true,
          data: {
            success: true,
            message: `${provider} API key format appears valid`,
            details: { provider },
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to validate API key',
        };
      }
    }
  );

  // Test full Graphiti connection (Database + LLM provider)
  ipcMain.handle(
    IPC_CHANNELS.GRAPHITI_TEST_CONNECTION,
    async (
      _,
      config: {
        dbPath?: string;
        database?: string;
        llmProvider: string;
        apiKey: string;
      }
    ): Promise<IPCResult<GraphitiConnectionTestResult>> => {
      try {
        // Test database connection
        let databaseResult: GraphitiValidationResult;

        if (!isKuzuAvailable()) {
          databaseResult = {
            success: false,
            message: 'kuzu-node is not installed. Memory features require Python 3.12+ with LadybugDB.',
          };
        } else {
          const service = getMemoryService({
            dbPath: config.dbPath || getDefaultDbPath(),
            database: config.database || 'auto_claude_memory',
          });
          databaseResult = await service.testConnection();
        }

        // Test LLM provider
        let llmResult: GraphitiValidationResult;

        if (config.llmProvider === 'openai') {
          llmResult = await validateOpenAIApiKey(config.apiKey);
        } else if (config.llmProvider === 'ollama') {
          // Ollama doesn't need API key validation
          llmResult = {
            success: true,
            message: 'Ollama (local) does not require API key validation',
            details: { provider: 'ollama' },
          };
        } else {
          // Basic validation for other providers
          llmResult = config.apiKey?.trim()
            ? {
                success: true,
                message: `${config.llmProvider} API key format appears valid`,
                details: { provider: config.llmProvider },
              }
            : {
                success: false,
                message: 'API key is required',
              };
        }

        return {
          success: true,
          data: {
            database: databaseResult,
            llmProvider: llmResult,
            ready: databaseResult.success && llmResult.success,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test Graphiti connection',
        };
      }
    }
  );

  // ============================================
  // Ollama Model Detection Handlers
  // ============================================

  // Check if Ollama is running
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA_CHECK_STATUS,
    async (_, baseUrl?: string): Promise<IPCResult<OllamaStatus>> => {
      try {
        const result = await executeOllamaDetector('check-status', baseUrl);

        if (!result.success) {
          return {
            success: false,
            error: result.error || 'Failed to check Ollama status',
          };
        }

        return {
          success: true,
          data: result.data as OllamaStatus,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check Ollama status',
        };
      }
    }
  );

  // Check if Ollama is installed (binary exists on system)
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA_CHECK_INSTALLED,
    async (): Promise<IPCResult<OllamaInstallStatus>> => {
      try {
        const installStatus = checkOllamaInstalled();
        return {
          success: true,
          data: installStatus,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check Ollama installation',
        };
      }
    }
  );

  // Install Ollama (opens terminal with official install command)
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA_INSTALL,
    async (): Promise<IPCResult<{ command: string }>> => {
      try {
        const command = getOllamaInstallCommand();
        console.log('[Ollama] Platform:', getCurrentOS());
        console.log('[Ollama] Install command:', command);
        console.log('[Ollama] Opening terminal...');

        await openTerminalWithCommand(command);
        console.log('[Ollama] Terminal opened successfully');

        return {
          success: true,
          data: { command },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : '';
        console.error('[Ollama] Install failed:', errorMsg);
        console.error('[Ollama] Error stack:', errorStack);
        return {
          success: false,
          error: `Failed to open terminal for installation: ${errorMsg}`,
        };
      }
    }
  );

    // ============================================
    // Ollama Model Discovery & Management
    // ============================================

    /**
    * List all available Ollama models (LLMs and embeddings).
    * Queries Ollama API to get model names, sizes, and metadata.
    *
    * @async
    * @param {string} [baseUrl] - Optional custom Ollama base URL
    * @returns {Promise<IPCResult<{ models, count }>>} Array of models with metadata
    */
   ipcMain.handle(
     IPC_CHANNELS.OLLAMA_LIST_MODELS,
     async (_, baseUrl?: string): Promise<IPCResult<{ models: OllamaModel[]; count: number }>> => {
      try {
        const result = await executeOllamaDetector('list-models', baseUrl);

        if (!result.success) {
          return {
            success: false,
            error: result.error || 'Failed to list Ollama models',
          };
        }

        const data = result.data as { models: OllamaModel[]; count: number; url: string };
        return {
          success: true,
          data: {
            models: data.models,
            count: data.count,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list Ollama models',
        };
      }
    }
  );

   /**
    * List only embedding models from Ollama.
    * Filters the model list to show only models suitable for semantic search.
    * Includes dimension info for model compatibility verification.
    *
    * @async
    * @param {string} [baseUrl] - Optional custom Ollama base URL
    * @returns {Promise<IPCResult<{ embedding_models, count }>>} Filtered embedding models
    */
   ipcMain.handle(
     IPC_CHANNELS.OLLAMA_LIST_EMBEDDING_MODELS,
     async (
       _,
       baseUrl?: string
     ): Promise<IPCResult<{ embedding_models: OllamaEmbeddingModel[]; count: number }>> => {
      try {
        const result = await executeOllamaDetector('list-embedding-models', baseUrl);

        if (!result.success) {
          return {
            success: false,
            error: result.error || 'Failed to list Ollama embedding models',
          };
        }

        const data = result.data as {
          embedding_models: OllamaEmbeddingModel[];
          count: number;
          url: string;
        };
        return {
          success: true,
          data: {
            embedding_models: data.embedding_models,
            count: data.count,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list embedding models',
        };
      }
    }
  );

   /**
    * Download (pull) an Ollama model from the Ollama registry.
    * Spawns a Python subprocess to execute ollama pull command with real-time progress tracking.
    * Emits OLLAMA_PULL_PROGRESS events to renderer with percentage, speed, and ETA.
    *
    * Progress events include:
    * - modelName: The model being downloaded
    * - status: Current status (downloading, extracting, etc.)
    * - completed: Bytes downloaded so far
    * - total: Total bytes to download
    * - percentage: Completion percentage (0-100)
    *
    * @async
    * @param {Electron.IpcMainInvokeEvent} event - IPC event object for sending progress updates
    * @param {string} modelName - Name of the model to download (e.g., 'embeddinggemma')
    * @param {string} [baseUrl] - Optional custom Ollama base URL
    * @returns {Promise<IPCResult<OllamaPullResult>>} Result with status and output messages
    */
   ipcMain.handle(
     IPC_CHANNELS.OLLAMA_PULL_MODEL,
     async (
       event,
       modelName: string,
       _baseUrl?: string
     ): Promise<IPCResult<OllamaPullResult>> => {
      try {
        // Use configured Python path (venv if ready, otherwise bundled/system)
        const pythonCmd = getConfiguredPythonPath();

        // Find the ollama_model_detector.py script
        const possiblePaths = [
          // Packaged app paths (check FIRST for packaged builds)
          ...(app.isPackaged
            ? [path.join(process.resourcesPath, 'backend', 'ollama_model_detector.py')]
            : []),
          // Development paths
          path.resolve(__dirname, '..', '..', '..', 'backend', 'ollama_model_detector.py'),
          path.resolve(process.cwd(), 'apps', 'backend', 'ollama_model_detector.py')
        ];

        let scriptPath: string | null = null;
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            scriptPath = p;
            break;
          }
        }

        if (!scriptPath) {
          return { success: false, error: 'ollama_model_detector.py script not found' };
        }

        const [pythonExe, baseArgs] = parsePythonCommand(pythonCmd);
        const args = [...baseArgs, scriptPath, 'pull-model', modelName];

        return new Promise((resolve) => {
          const proc = spawn(pythonExe, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 600000, // 10 minute timeout for large models
            // Use sanitized Python environment to prevent PYTHONHOME contamination
            // Fixes "Could not find platform independent libraries" error on Windows
            env: pythonEnvManager.getPythonEnv(),
          });

          let stdout = '';
          let stderr = '';
          let stderrBuffer = ''; // Buffer for NDJSON parsing

          proc.stdout.on('data', (data) => {
            stdout += data.toString('utf-8');
          });

          proc.stderr.on('data', (data) => {
            const chunk = data.toString('utf-8');
            stderr += chunk;
            stderrBuffer += chunk;

            // Parse NDJSON (newline-delimited JSON) from stderr
            // Ollama sends progress data as: {"status":"downloading","completed":X,"total":Y}
            const lines = stderrBuffer.split('\n');
            // Keep the last incomplete line in the buffer
            stderrBuffer = lines.pop() || '';

            lines.forEach((line) => {
              if (line.trim()) {
                try {
                  const progressData = JSON.parse(line);

                  // Extract progress information
                  if (progressData.completed !== undefined && progressData.total !== undefined) {
                    const percentage = progressData.total > 0
                      ? Math.round((progressData.completed / progressData.total) * 100)
                      : 0;

                    // Emit progress event to renderer
                    event.sender.send(IPC_CHANNELS.OLLAMA_PULL_PROGRESS, {
                      modelName,
                      status: progressData.status || 'downloading',
                      completed: progressData.completed,
                      total: progressData.total,
                      percentage,
                    });
                  }
                } catch {
                  // Skip lines that aren't valid JSON
                }
              }
            });
          });

          proc.on('close', (code) => {
            if (code === 0 && stdout) {
              try {
                const result = JSON.parse(stdout);
                if (result.success) {
                  resolve({
                    success: true,
                    data: result.data as OllamaPullResult,
                  });
                } else {
                  resolve({
                    success: false,
                    error: result.error || 'Failed to pull model',
                  });
                }
              } catch {
                resolve({ success: false, error: `Invalid JSON: ${stdout}` });
              }
            } else {
              resolve({ success: false, error: stderr || `Exit code ${code}` });
            }
          });

          proc.on('error', (err) => {
            resolve({ success: false, error: err.message });
          });
        });
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to pull model',
        };
      }
    }
  );

  // ============================================
  // Per-Project Memory Browser Handlers
  // ============================================
  registerMemoryBrowserHandlers();
}

/**
 * Resolve the LadybugDB-backed MemoryService for a given project.
 *
 * Looks up the project in the main projectStore to get its real path, checks
 * whether Graphiti/LadybugDB memory is enabled and available, then builds a
 * MemoryService bound to the project's configured database.
 *
 * Returns `null` when the project is missing, memory is disabled, or the
 * embedded database engine is unavailable so callers can return a friendly
 * empty result instead of throwing.
 */
function resolveProjectMemory(
  projectId: string
): {
  service: MemoryService | null;
  projectDir: string;
  autoBuildPath?: string;
} | null {
  const project = projectStore.getProject(projectId);
  if (!project) {
    return null;
  }

  const appSettings = (readSettingsFile() || {}) as Partial<AppSettings>;
  const appEnvVars = buildMemoryEnvVars(appSettings as AppSettings);
  const projectEnvVars = loadProjectEnvVars(project.path, project.autoBuildPath);
  const effectiveEnvVars = { ...appEnvVars, ...projectEnvVars };
  if (!isGraphitiEnabled(effectiveEnvVars)) {
    return null;
  }

  let service: MemoryService | null = null;
  if (isKuzuAvailable()) {
    const dbDetails = getGraphitiDatabaseDetails(effectiveEnvVars);
    service = getMemoryService({
      dbPath: dbDetails.dbPath || getDefaultDbPath(),
      database: dbDetails.database,
    });
  }

  return {
    service,
    projectDir: project.path,
    autoBuildPath: project.autoBuildPath,
  };
}

/**
 * Load legacy per-spec session memories for projects that have not yet been
 * migrated into LadybugDB. This keeps the new browser useful while the graph
 * database is empty and provides a single visible memory history to users.
 */
function loadProjectFileMemories(
  projectDir: string,
  autoBuildPath: string | undefined,
  limit: number
): MemoryTimelineEntry[] {
  if (!autoBuildPath) {
    return [];
  }

  const specsDir = path.join(projectDir, getSpecsDir(autoBuildPath));
  return loadFileBasedMemories(specsDir, limit, {
    maxSpecs: Number.POSITIVE_INFINITY,
    maxSessionsPerSpec: Number.POSITIVE_INFINITY,
  }).map((memory) => ({
    ...memory,
    storage: 'file',
  }));
}

/**
 * Combine graph-backed and legacy file memories without allowing the first
 * graph write to hide older session history. Graph records win exact duplicate
 * signatures because they support edit/prune operations.
 */
function mergeProjectMemories(
  graphMemories: MemoryTimelineEntry[],
  fileMemories: MemoryTimelineEntry[],
  limit: number
): MemoryTimelineEntry[] {
  const merged = new Map<string, MemoryTimelineEntry>();

  for (const memory of [...graphMemories, ...fileMemories]) {
    const signature = [
      memory.type,
      memory.timestamp,
      memory.content,
    ].join('\u0000');
    if (!merged.has(signature)) {
      merged.set(signature, memory);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}

/**
 * Register the per-project memory browser IPC handlers.
 *
 * Each handler resolves the project's LadybugDB-backed MemoryService and calls
 * the corresponding method. When memory is disabled or the database is missing,
 * handlers return a friendly empty result rather than throwing.
 */
function registerMemoryBrowserHandlers(): void {
  // Whether Graphiti memory is enabled and available for a project.
  // Drives the "memory disabled" empty state in the renderer.
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_ENABLED,
    async (_, projectId: string): Promise<IPCResult<boolean>> => {
      try {
        return { success: true, data: resolveProjectMemory(projectId) !== null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check memory status',
        };
      }
    }
  );

  // Browse entities (knowledge-graph nodes) scoped to a project
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_BROWSE_ENTITIES,
    async (_, projectId: string, limit: number = 20): Promise<IPCResult<MemoryEntity[]>> => {
      try {
        const resolved = resolveProjectMemory(projectId);
        if (!resolved) {
          return { success: true, data: [] };
        }
        if (!resolved.service?.databaseExists()) {
          return { success: true, data: [] };
        }
        const data = await resolved.service.browseEntities(resolved.projectDir, limit);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to browse entities',
        };
      }
    }
  );

  // Browse episodic memories scoped to a project
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_BROWSE_EPISODES,
    async (_, projectId: string, limit: number = 20): Promise<IPCResult<MemoryTimelineEntry[]>> => {
      try {
        const resolved = resolveProjectMemory(projectId);
        if (!resolved) {
          return { success: true, data: [] };
        }
        const graphData = resolved.service?.databaseExists()
          ? await resolved.service.browseEpisodes(resolved.projectDir, limit)
          : [];
        const fileData = loadProjectFileMemories(
          resolved.projectDir,
          resolved.autoBuildPath,
          limit
        );
        const data = mergeProjectMemories(graphData, fileData, limit);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to browse episodes',
        };
      }
    }
  );

  // List entity-to-entity relationships scoped to a project
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_RELATIONSHIPS,
    async (_, projectId: string, limit: number = 20): Promise<IPCResult<MemoryRelationship[]>> => {
      try {
        const resolved = resolveProjectMemory(projectId);
        if (!resolved) {
          return { success: true, data: [] };
        }
        if (!resolved.service?.databaseExists()) {
          return { success: true, data: [] };
        }
        const data = await resolved.service.getRelationships(resolved.projectDir, limit);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get relationships',
        };
      }
    }
  );

  // Keyword-search memories scoped to a project
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_SEARCH,
    async (
      _,
      projectId: string,
      query: string,
      limit: number = 20
    ): Promise<IPCResult<MemoryEpisode[]>> => {
      try {
        const resolved = resolveProjectMemory(projectId);
        if (!resolved || !query || !query.trim()) {
          return { success: true, data: [] };
        }
        const graphData = resolved.service?.databaseExists()
          ? await resolved.service.searchScoped(resolved.projectDir, query, limit)
          : [];
        const normalizedQuery = query.trim().toLowerCase();
        const fileData = loadProjectFileMemories(
          resolved.projectDir,
          resolved.autoBuildPath,
          Number.POSITIVE_INFINITY
        ).filter((memory) => memory.content.toLowerCase().includes(normalizedQuery));
        const data = mergeProjectMemories(graphData, fileData, limit);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to search memories',
        };
      }
    }
  );

  // Chronological insight timeline scoped to a project
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_TIMELINE,
    async (_, projectId: string, limit: number = 20): Promise<IPCResult<MemoryTimelineEntry[]>> => {
      try {
        const resolved = resolveProjectMemory(projectId);
        if (!resolved) {
          return { success: true, data: [] };
        }
        const graphData = resolved.service?.databaseExists()
          ? await resolved.service.getTimeline(resolved.projectDir, limit)
          : [];
        const fileData = loadProjectFileMemories(
          resolved.projectDir,
          resolved.autoBuildPath,
          limit
        );
        const data = mergeProjectMemories(graphData, fileData, limit);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get timeline',
        };
      }
    }
  );

  // Delete a single memory node (episodic or entity)
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_DELETE_ENTRY,
    async (
      _,
      projectId: string,
      uuid: string,
      kind: MemoryKind
    ): Promise<IPCResult<{ deleted?: boolean; id?: string }>> => {
      try {
        const resolved = resolveProjectMemory(projectId);
        if (!resolved?.service?.databaseExists()) {
          return { success: false, error: 'Memory is not enabled for this project' };
        }
        const result = await resolved.service.deleteEntry(resolved.projectDir, uuid, kind);
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to delete memory entry' };
        }
        return { success: true, data: { deleted: result.deleted, id: result.id } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete memory entry',
        };
      }
    }
  );

  // Update a single memory node (episodic or entity)
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_UPDATE_ENTRY,
    async (
      _,
      projectId: string,
      uuid: string,
      kind: MemoryKind,
      payload: MemoryUpdatePayload
    ): Promise<IPCResult<{ record?: MemoryEpisode }>> => {
      try {
        const resolved = resolveProjectMemory(projectId);
        if (!resolved?.service?.databaseExists()) {
          return { success: false, error: 'Memory is not enabled for this project' };
        }
        const result = await resolved.service.updateEntry(
          resolved.projectDir,
          uuid,
          kind,
          payload
        );
        if (!result.success) {
          return { success: false, error: result.error || 'Failed to update memory entry' };
        }
        return { success: true, data: { record: result.record } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update memory entry',
        };
      }
    }
  );
}
