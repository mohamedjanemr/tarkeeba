import { spawn, ChildProcess } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import type {
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  InsightsModelConfig,
  InsightsProviderConfig,
  ImageAttachment
} from '../../shared/types';
import { MODEL_ID_MAP, MAX_IMAGES_PER_TASK, MAX_IMAGE_SIZE } from '../../shared/constants';
import { InsightsConfig } from './config';
import { detectRateLimit, createSDKRateLimitInfo } from '../rate-limit-detector';
import { killProcessGracefully } from '../platform';
import { getOpenAIProfileManager } from '../openai-profile-manager';
import {
  buildCodexInsightsArgs,
  buildCodexInsightsPrompt,
  DEFAULT_CODEX_INSIGHTS_EFFORT,
  DEFAULT_CODEX_INSIGHTS_MODEL,
  parseCodexInsightsEvent,
} from './codex-insights';

// Safe extension map for image MIME types — prevents path traversal via crafted mimeType
// SVG excluded: contains active script content and is unsupported by Claude Vision API
const SAFE_EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

/**
 * Message processor result
 */
interface ProcessorResult {
  fullResponse: string;
  suggestedTasks?: InsightsChatMessage['suggestedTasks'];
  toolsUsed: InsightsToolUsage[];
  cancelled?: boolean;
}

/**
 * Python process executor for insights
 * Handles spawning and managing the Python insights runner process
 */
export class InsightsExecutor extends EventEmitter {
  private config: InsightsConfig;
  private activeSessions: Map<string, ChildProcess> = new Map();
  private cancelledProcesses = new WeakSet<ChildProcess>();

  constructor(config: InsightsConfig) {
    super();
    this.config = config;
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(projectId: string): boolean {
    return this.activeSessions.has(projectId);
  }

  /**
   * Cancel an active session
   */
  cancelSession(projectId: string): boolean {
    const existingProcess = this.activeSessions.get(projectId);
    if (!existingProcess) return false;

    this.cancelledProcesses.add(existingProcess);
    killProcessGracefully(existingProcess, {
      debugPrefix: '[Insights]',
      timeoutMs: 2000,
    });
    return true;
  }

  /**
   * Execute insights query
   */
  async execute(
    projectId: string,
    projectPath: string,
    message: string,
    conversationHistory: Array<{ role: string; content: string }>,
    modelConfig?: InsightsModelConfig,
    images?: ImageAttachment[],
    providerConfig?: InsightsProviderConfig
  ): Promise<ProcessorResult> {
    // Cancel any existing session
    this.cancelSession(projectId);

    const useCodex = providerConfig?.provider === 'codex';
    const codexProfile = useCodex
      ? getOpenAIProfileManager().getProfile(providerConfig.codexProfileId)
      : undefined;
    if (useCodex && !codexProfile) throw new Error('No Codex account is selected');
    if (useCodex && !codexProfile?.isAuthenticated) {
      throw new Error(`Codex account "${codexProfile?.name}" is not authenticated`);
    }

    const autoBuildSource = this.config.getAutoBuildSourcePath();
    if (!useCodex && !autoBuildSource) {
      throw new Error('Tarkeeba source not found');
    }

    const runnerPath = autoBuildSource
      ? path.join(autoBuildSource, 'runners', 'insights_runner.py')
      : '';
    if (!useCodex && !existsSync(runnerPath)) {
      throw new Error('insights_runner.py not found in auto-claude directory');
    }

    // Emit thinking status
    this.emit('status', projectId, {
      phase: 'thinking',
      message: 'Processing your message...'
    } as InsightsChatStatus);

    // Get process environment
    const processEnv = await this.config.getProcessEnv();

    // Write conversation history to temp file to avoid Windows command-line length limit
    const historyFile = path.join(
      os.tmpdir(),
      `insights-history-${projectId}-${Date.now()}-${randomBytes(8).toString('hex')}.json`
    );

    let historyFileCreated = false;
    try {
      await writeFile(historyFile, JSON.stringify(conversationHistory), { encoding: 'utf-8', mode: 0o600 });
      historyFileCreated = true;
    } catch (err) {
      console.error('[Insights] Failed to write history file:', err);
      throw new Error('Failed to write conversation history to temp file');
    }

    // Write image files and manifest if images are provided
    const imagesTempFiles: string[] = [];
    const imageTempPaths: string[] = [];
    let imagesManifestFile: string | undefined;

    // Defense-in-depth: cap image count and filter oversized images in the executor
    if (images && images.length > MAX_IMAGES_PER_TASK) {
      images = images.slice(0, MAX_IMAGES_PER_TASK);
    }
    if (images) {
      images = images.filter(img => !img.data || Buffer.byteLength(img.data, 'base64') <= MAX_IMAGE_SIZE);
    }

    if (images && images.length > 0) {
      try {
        const manifest: Array<{ path: string; mimeType: string }> = [];
        const timestamp = Date.now();

        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          if (!image.data) continue;

          // Validate mimeType against allowlist (defense-in-depth for main process)
          const ext = SAFE_EXT_MAP[image.mimeType];
          if (!ext) {
            console.warn(`[Insights] Skipping image with invalid mimeType: ${image.mimeType}`);
            continue;
          }

          const imagePath = path.join(
            os.tmpdir(),
            `insights-image-${projectId}-${timestamp}-${i}-${randomBytes(8).toString('hex')}.${ext}`
          );
          await writeFile(imagePath, Buffer.from(image.data, 'base64'), { mode: 0o600 });
          imagesTempFiles.push(imagePath);
          imageTempPaths.push(imagePath);
          manifest.push({ path: imagePath, mimeType: image.mimeType });
        }

        // Only write manifest file if we actually wrote any images
        if (manifest.length > 0) {
          imagesManifestFile = path.join(
            os.tmpdir(),
            `insights-images-manifest-${projectId}-${timestamp}-${randomBytes(8).toString('hex')}.json`
          );
          imagesTempFiles.push(imagesManifestFile); // Push before writeFile for cleanup on failure
          await writeFile(imagesManifestFile, JSON.stringify(manifest), { encoding: 'utf-8', mode: 0o600 });
        }
      } catch (err) {
        // Clean up any already-written image files
        for (const tmpFile of imagesTempFiles) {
          try {
            if (existsSync(tmpFile)) unlinkSync(tmpFile);
          } catch { /* ignore cleanup errors */ }
        }
        // Also clean up the history file (cleanupTempFiles isn't defined yet at this point)
        if (existsSync(historyFile)) {
          try { unlinkSync(historyFile); } catch { /* ignore */ }
        }
        console.error('[Insights] Failed to write image files:', err);
        throw new Error('Failed to write image files to temp directory');
      }
    }

    let executable: string;
    let args: string[];
    let cwd: string;
    let spawnEnv = processEnv;
    let stdinPrompt: string | undefined;

    if (useCodex) {
      executable = processEnv.CODEX_CLI_PATH || 'codex';
      args = buildCodexInsightsArgs(
        projectPath,
        providerConfig.codexModel || DEFAULT_CODEX_INSIGHTS_MODEL,
        providerConfig.codexReasoningEffort || DEFAULT_CODEX_INSIGHTS_EFFORT,
        imageTempPaths
      );
      cwd = projectPath;
      stdinPrompt = buildCodexInsightsPrompt(message, conversationHistory);
      spawnEnv = {
        ...Object.fromEntries(
          Object.entries(processEnv).filter(([key]) =>
            !key.startsWith('CLAUDE_') && !key.startsWith('ANTHROPIC_')
          )
        ),
        CODEX_HOME: codexProfile?.codexHome as string,
      };
    } else {
      executable = this.config.getPythonPath();
      args = [
        runnerPath,
        '--project-dir', projectPath,
        '--message', message,
        '--history-file', historyFile
      ];
      if (imagesManifestFile) args.push('--images-file', imagesManifestFile);
      if (modelConfig) {
        const modelId = MODEL_ID_MAP[modelConfig.model] || MODEL_ID_MAP['sonnet'];
        args.push('--model', modelId);
        args.push('--thinking-level', modelConfig.thinkingLevel);
      }
      cwd = autoBuildSource as string;
    }

    const proc = spawn(executable, args, { cwd, env: spawnEnv });
    this.activeSessions.set(projectId, proc);

    // Shared cleanup for temp files used across close/error handlers
    let cleanedUp = false;
    const cleanupTempFiles = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (historyFileCreated && existsSync(historyFile)) {
        try {
          unlinkSync(historyFile);
        } catch (cleanupErr) {
          console.error('[Insights] Failed to cleanup history file:', cleanupErr);
        }
      }
      for (const tmpFile of imagesTempFiles) {
        try {
          if (existsSync(tmpFile)) unlinkSync(tmpFile);
        } catch (cleanupErr) {
          console.error('[Insights] Failed to cleanup image temp file:', cleanupErr);
        }
      }
    };

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      const suggestedTasks: InsightsChatMessage['suggestedTasks'] = [];
      const toolsUsed: InsightsToolUsage[] = [];
      let allInsightsOutput = '';
      let stderrOutput = '';
      let stdoutBuffer = '';
      let codexReportedError = false;

      const handleTextLine = (line: string) => {
        if (line.startsWith('__TASK_SUGGESTION__:')) {
          this.handleTaskSuggestion(projectId, line, (task) => {
            if (task) suggestedTasks.push(task);
          });
        } else if (line.startsWith('__TOOL_START__:')) {
          this.handleToolStart(projectId, line, toolsUsed);
        } else if (line.startsWith('__TOOL_END__:')) {
          this.handleToolEnd(projectId, line);
        } else if (line.trim()) {
          fullResponse += line + '\n';
          this.emit('stream-chunk', projectId, {
            type: 'text',
            content: line + '\n'
          } as InsightsStreamChunk);
        }
      };

      const handleCodexLine = (line: string) => {
        const event = parseCodexInsightsEvent(line);
        if (!event) return;
        if (event.type === 'text' && event.content) {
          for (const textLine of event.content.split('\n')) handleTextLine(textLine);
        } else if (event.type === 'tool_start' && event.tool) {
          toolsUsed.push({ ...event.tool, timestamp: new Date() });
          this.emit('stream-chunk', projectId, {
            type: 'tool_start',
            tool: event.tool
          } as InsightsStreamChunk);
        } else if (event.type === 'tool_end' && event.tool) {
          this.emit('stream-chunk', projectId, {
            type: 'tool_end',
            tool: event.tool
          } as InsightsStreamChunk);
        } else if (event.type === 'error' && event.error) {
          codexReportedError = true;
          stderrOutput = (stderrOutput + event.error).slice(-2000);
        }
      };

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        // Collect output for rate limit detection (keep last 10KB)
        allInsightsOutput = (allInsightsOutput + text).slice(-10000);

        if (useCodex) {
          stdoutBuffer += text;
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop() ?? '';
          for (const line of lines) handleCodexLine(line);
        } else {
          for (const line of text.split('\n')) handleTextLine(line);
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        // Collect stderr for rate limit detection and error reporting
        allInsightsOutput = (allInsightsOutput + text).slice(-10000);
        stderrOutput = (stderrOutput + text).slice(-2000);
        console.error('[Insights]', text);
      });

      proc.on('close', (code) => {
        if (useCodex && stdoutBuffer.trim()) handleCodexLine(stdoutBuffer);
        if (this.activeSessions.get(projectId) === proc) {
          this.activeSessions.delete(projectId);
        }
        cleanupTempFiles();

        const wasCancelled = this.cancelledProcesses.has(proc);
        if (wasCancelled) {
          this.emit('stream-chunk', projectId, {
            type: 'done'
          } as InsightsStreamChunk);

          this.emit('status', projectId, {
            phase: 'complete',
            message: 'Response stopped'
          } as InsightsChatStatus);

          resolve({
            fullResponse: fullResponse.trim(),
            suggestedTasks: suggestedTasks.length > 0 ? suggestedTasks : undefined,
            toolsUsed,
            cancelled: true
          });
          return;
        }

        // Check for rate limit if process failed
        if (code !== 0) {
          this.handleRateLimit(projectId, allInsightsOutput);
        }

        if (code === 0 && !codexReportedError) {
          this.emit('stream-chunk', projectId, {
            type: 'done'
          } as InsightsStreamChunk);

          this.emit('status', projectId, {
            phase: 'complete'
          } as InsightsChatStatus);

          resolve({
            fullResponse: fullResponse.trim(),
            suggestedTasks: suggestedTasks.length > 0 ? suggestedTasks : undefined,
            toolsUsed
          });
        } else {
          // Include stderr output in error message for debugging
          const stderrSummary = stderrOutput.trim()
            ? `\n\nError output:\n${stderrOutput.slice(-500)}`
            : '';
          const error = `${useCodex ? 'Codex' : 'Process'} exited with code ${code}${stderrSummary}`;
          this.emit('stream-chunk', projectId, {
            type: 'error',
            error
          } as InsightsStreamChunk);

          this.emit('error', projectId, error);
          reject(new Error(error));
        }
      });

      proc.on('error', (err) => {
        if (this.activeSessions.get(projectId) === proc) {
          this.activeSessions.delete(projectId);
        }
        cleanupTempFiles();

        this.emit('error', projectId, err.message);
        reject(err);
      });

      if (stdinPrompt && proc.stdin) {
        // A missing/early-exiting CLI can close stdin before the prompt is
        // written; the process error/close handlers above report the failure.
        proc.stdin.on('error', () => {
          // The process-level handlers report the actionable failure.
        });
        proc.stdin.end(stdinPrompt);
      }
    });
  }

  /**
   * Handle task suggestion from output
   */
  private handleTaskSuggestion(
    projectId: string,
    line: string,
    onTaskFound: (task: NonNullable<InsightsChatMessage['suggestedTasks']>[number]) => void
  ): void {
    try {
      const taskJson = line.substring('__TASK_SUGGESTION__:'.length);
      const suggestedTask = JSON.parse(taskJson);
      onTaskFound(suggestedTask);
      this.emit('stream-chunk', projectId, {
        type: 'task_suggestion',
        suggestedTasks: [suggestedTask]
      } as InsightsStreamChunk);
    } catch {
      // Not valid JSON, treat as normal text (should not emit here as it's already handled)
    }
  }

  /**
   * Handle tool start marker
   */
  private handleToolStart(
    projectId: string,
    line: string,
    toolsUsed: InsightsToolUsage[]
  ): void {
    try {
      const toolJson = line.substring('__TOOL_START__:'.length);
      const toolData = JSON.parse(toolJson);
      // Accumulate tool usage for persistence
      toolsUsed.push({
        name: toolData.name,
        input: toolData.input,
        timestamp: new Date()
      });
      this.emit('stream-chunk', projectId, {
        type: 'tool_start',
        tool: {
          name: toolData.name,
          input: toolData.input
        }
      } as InsightsStreamChunk);
    } catch {
      // Ignore parse errors for tool markers
    }
  }

  /**
   * Handle tool end marker
   */
  private handleToolEnd(projectId: string, line: string): void {
    try {
      const toolJson = line.substring('__TOOL_END__:'.length);
      const toolData = JSON.parse(toolJson);
      this.emit('stream-chunk', projectId, {
        type: 'tool_end',
        tool: {
          name: toolData.name
        }
      } as InsightsStreamChunk);
    } catch {
      // Ignore parse errors for tool markers
    }
  }

  /**
   * Handle rate limit detection
   */
  private handleRateLimit(projectId: string, output: string): void {
    const rateLimitDetection = detectRateLimit(output);
    if (rateLimitDetection.isRateLimited) {
      console.warn('[Insights] Rate limit detected:', {
        projectId,
        resetTime: rateLimitDetection.resetTime,
        limitType: rateLimitDetection.limitType,
        suggestedProfile: rateLimitDetection.suggestedProfile?.name
      });

      const rateLimitInfo = createSDKRateLimitInfo('other', rateLimitDetection, {
        projectId
      });
      this.emit('sdk-rate-limit', rateLimitInfo);
    }
  }
}
