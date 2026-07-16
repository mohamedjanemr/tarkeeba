/**
 * Azure DevOps PR Review IPC handlers
 *
 * Handles AI-powered PR review:
 * 1. Get PR diff
 * 2. Run AI review with code analysis
 * 3. Post review comments
 * 4. Merge PR
 * 5. Assign reviewers
 * 6. Check for new commits
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS, MODEL_ID_MAP, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING } from '../../../shared/constants';
import type { AuthFailureInfo } from '../../../shared/types/terminal';
import { getAzureDevOpsConfig, azureDevOpsFetch, encodeProjectName } from './utils';
import { readSettingsFile } from '../../settings-utils';
import type { Project, AppSettings } from '../../../shared/types';
import type {
  PRReviewResult,
  PRReviewProgress,
  NewCommitsCheck,
} from './types';
import { createContextLogger } from '../github/utils/logger';
import { withProjectOrNull } from '../github/utils/project-middleware';
import { createIPCCommunicators } from '../github/utils/ipc-communicator';
import {
  runPythonSubprocess,
  getPythonPath,
  buildRunnerArgs,
} from '../github/utils/subprocess-runner';
import { getRunnerEnv } from '../github/utils/runner-env';

/**
 * Get the Azure DevOps runner path
 */
function getAzureDevOpsRunnerPath(backendPath: string): string {
  return path.join(backendPath, 'runners', 'azure_devops', 'runner.py');
}

// Debug logging
const { debug: debugLog } = createContextLogger('Azure DevOps PR');

/**
 * Registry of running PR review processes
 * Key format: `${projectId}:${prId}`
 */
const runningReviews = new Map<string, import('child_process').ChildProcess>();

const REBASE_POLL_INTERVAL_MS = 1000;
// Default rebase timeout (60 seconds). Can be overridden via AZURE_DEVOPS_REBASE_TIMEOUT_MS env var
const REBASE_TIMEOUT_MS = parseInt(process.env.AZURE_DEVOPS_REBASE_TIMEOUT_MS || '60000', 10);

/**
 * Get the registry key for a PR review
 */
function getReviewKey(projectId: string, prId: number): string {
  return `${projectId}:${prId}`;
}

/**
 * Get the Azure DevOps directory for a project
 */
function getAzureDevOpsDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'azure-devops');
}

async function waitForRebaseCompletion(
  pat: string,
  organization: string,
  project: string,
  prId: number
): Promise<void> {
  const deadline = Date.now() + REBASE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const encodedProject = encodeProjectName(project);
    const prData = await azureDevOpsFetch(
      pat,
      organization,
      `/git/repositories/*/pullrequests/${prId}`
    ) as { isDraft?: boolean; status?: string };

    // In Azure DevOps, if the PR is not in draft state, rebase has completed
    if (!prData.isDraft) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, REBASE_POLL_INTERVAL_MS));
  }

  throw new Error('Rebase did not complete before timeout');
}

/**
 * Get saved PR review result
 */
function getReviewResult(project: Project, prId: number): PRReviewResult | null {
  const reviewPath = path.join(getAzureDevOpsDir(project), 'pr', `review_${prId}.json`);

  if (fs.existsSync(reviewPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
      return {
        prId: data.pr_id,
        project: data.project,
        success: data.success,
        findings: data.findings?.map((f: Record<string, unknown>) => ({
          id: f.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          description: f.description,
          file: f.file,
          line: f.line,
          endLine: f.end_line,
          suggestedFix: f.suggested_fix,
          fixable: f.fixable ?? false,
        })) ?? [],
        summary: data.summary ?? '',
        overallStatus: data.overall_status ?? 'comment',
        reviewedAt: data.reviewed_at ?? new Date().toISOString(),
        reviewedCommitSha: data.reviewed_commit_sha,
        isFollowupReview: data.is_followup_review ?? false,
        previousReviewId: data.previous_review_id,
        resolvedFindings: data.resolved_findings ?? [],
        unresolvedFindings: data.unresolved_findings ?? [],
        newFindingsSinceLastReview: data.new_findings_since_last_review ?? [],
        hasPostedFindings: data.has_posted_findings ?? false,
        postedFindingIds: data.posted_finding_ids ?? [],
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Get Azure DevOps PR model and thinking settings from app settings
 */
function getAzureDevOpsSettings(): { model: string; thinkingLevel: string } {
  const rawSettings = readSettingsFile() as Partial<AppSettings> | undefined;

  // Get feature models/thinking with defaults
  const featureModels = rawSettings?.featureModels ?? DEFAULT_FEATURE_MODELS;
  const featureThinking = rawSettings?.featureThinking ?? DEFAULT_FEATURE_THINKING;

  // Use GitHub PRs settings as fallback (Azure DevOps PRs not yet in settings)
  const modelShort = featureModels.githubPrs ?? DEFAULT_FEATURE_MODELS.githubPrs;
  const thinkingLevel = featureThinking.githubPrs ?? DEFAULT_FEATURE_THINKING.githubPrs;

  // Convert model short name to full model ID
  const model = MODEL_ID_MAP[modelShort] ?? MODEL_ID_MAP['opus'];

  debugLog('Azure DevOps PR settings', { modelShort, model, thinkingLevel });

  return { model, thinkingLevel };
}

/**
 * Validate Azure DevOps module is properly set up
 */
async function validateAzureDevOpsModule(project: Project): Promise<{ valid: boolean; backendPath?: string; error?: string }> {
  if (!project.autoBuildPath) {
    return { valid: false, error: 'Auto Build path not configured for this project' };
  }

  const backendPath = path.join(project.path, project.autoBuildPath);

  // Check if the runners directory exists
  const runnersPath = path.join(backendPath, 'runners', 'azure_devops');
  if (!fs.existsSync(runnersPath)) {
    return { valid: false, error: 'Azure DevOps runners not found. Please ensure the backend is properly installed.' };
  }

  return { valid: true, backendPath };
}

/**
 * Run the Python PR reviewer
 */
async function runPRReview(
  project: Project,
  prId: number,
  mainWindow: BrowserWindow
): Promise<PRReviewResult> {
  const validation = await validateAzureDevOpsModule(project);

  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const backendPath = validation.backendPath!;

  const { sendProgress } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
    mainWindow,
    {
      progress: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS,
      error: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR,
      complete: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE,
    },
    project.id
  );

  const { model, thinkingLevel } = getAzureDevOpsSettings();
  const args = buildRunnerArgs(
    getAzureDevOpsRunnerPath(backendPath),
    project.path,
    'review-pr',
    [prId.toString()],
    { model, thinkingLevel }
  );

  debugLog('Spawning PR review process', { args, model, thinkingLevel });

  // Get runner environment with PYTHONPATH for bundled packages (fixes #139)
  const subprocessEnv = await getRunnerEnv();

  const { process: childProcess, promise } = runPythonSubprocess<PRReviewResult>({
    pythonPath: getPythonPath(backendPath),
    args,
    cwd: backendPath,
    env: subprocessEnv,
    onProgress: (percent, message) => {
      debugLog('Progress update', { percent, message });
      sendProgress({
        phase: 'analyzing',
        prId,
        progress: percent,
        message,
      });
    },
    onStdout: (line) => debugLog('STDOUT:', line),
    onStderr: (line) => debugLog('STDERR:', line),
    onAuthFailure: (authFailureInfo: AuthFailureInfo) => {
      debugLog('Auth failure detected in PR review', authFailureInfo);
      mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
    },
    onComplete: () => {
      const reviewResult = getReviewResult(project, prId);
      if (!reviewResult) {
        throw new Error('Review completed but result not found');
      }
      debugLog('Review result loaded', { findingsCount: reviewResult.findings.length });
      return reviewResult;
    },
  });

  // Register the running process
  const reviewKey = getReviewKey(project.id, prId);
  runningReviews.set(reviewKey, childProcess);
  debugLog('Registered review process', { reviewKey, pid: childProcess.pid });

  try {
    const result = await promise;

    if (!result.success) {
      throw new Error(result.error ?? 'Review failed');
    }

    return result.data!;
  } finally {
    runningReviews.delete(reviewKey);
    debugLog('Unregistered review process', { reviewKey });
  }
}

/**
 * Register PR review handlers
 */
export function registerPRReviewHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering PR review handlers');

  // Get PR diff (feature parity with GitHub PR diff)
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_GET_DIFF,
    async (_, projectId: string, prId: number): Promise<string | null> => {
      return withProjectOrNull(projectId, async (project) => {
        const config = await getAzureDevOpsConfig(project);
        if (!config) return null;

        try {
          // Validate prId
          if (!Number.isInteger(prId) || prId <= 0) {
            throw new Error('Invalid PR ID');
          }

          const encodedProject = encodeProjectName(config.project);
          const iterations = await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}/iterations`
          ) as { value: Array<{ iterationId: number }> };

          if (!iterations.value || iterations.value.length === 0) {
            return null;
          }

          // Get the latest iteration changes
          const latestIteration = iterations.value[iterations.value.length - 1];
          const changes = await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}/iterations/${latestIteration.iterationId}/changes`
          ) as { value: Array<{ change: { item: { path: string }; changeType: string }; committedDate: string }> };

          // Combine all file changes into a diff-like format
          if (!changes.value) {
            return null;
          }

          const diffLines = changes.value.map(c => {
            const changeType = c.change.changeType;
            return `${changeType}: ${c.change.item.path}`;
          }).join('\n');

          return diffLines;
        } catch (error) {
          debugLog('Failed to get PR diff', { prId, error: error instanceof Error ? error.message : error });
          return null;
        }
      });
    }
  );

  // Get saved review
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_GET_REVIEW,
    async (_, projectId: string, prId: number): Promise<PRReviewResult | null> => {
      return withProjectOrNull(projectId, async (project) => {
        return getReviewResult(project, prId);
      });
    }
  );

  // Run AI review
  ipcMain.on(
    IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW,
    async (_, projectId: string, prId: number) => {
      debugLog('runPRReview handler called', { projectId, prId });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendComplete } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
            mainWindow,
            {
              progress: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS,
              error: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR,
              complete: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE,
            },
            projectId
          );

          debugLog('Starting PR review', { prId });
          sendProgress({
            phase: 'fetching',
            prId,
            progress: 10,
            message: 'Fetching PR data...',
          });

          const result = await runPRReview(project, prId, mainWindow);

          debugLog('PR review completed', { prId, findingsCount: result.findings.length });
          sendProgress({
            phase: 'complete',
            prId,
            progress: 100,
            message: 'Review complete!',
          });

          sendComplete(result);
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        debugLog('PR review failed', { prId, error: errorMessage });
        const { sendError } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
          mainWindow,
          {
            progress: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS,
            error: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR,
            complete: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE,
          },
          projectId
        );
        sendError({ prId, error: `PR review failed for PR #${prId}: ${errorMessage}` });
      }
    }
  );

  // Post review as comment to PR
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_POST_REVIEW,
    async (_, projectId: string, prId: number, selectedFindingIds?: string[]): Promise<boolean> => {
      debugLog('postPRReview handler called', { projectId, prId, selectedCount: selectedFindingIds?.length });
      const postResult = await withProjectOrNull(projectId, async (project) => {
        const result = getReviewResult(project, prId);
        if (!result) {
          debugLog('No review result found', { prId });
          return false;
        }

        const config = await getAzureDevOpsConfig(project);
        if (!config) {
          debugLog('No Azure DevOps config found');
          return false;
        }

        try {
          // Filter findings if selection provided
          const selectedSet = selectedFindingIds ? new Set(selectedFindingIds) : null;
          const findings = selectedSet
            ? result.findings.filter(f => selectedSet.has(f.id))
            : result.findings;

          debugLog('Posting findings', { total: result.findings.length, selected: findings.length });

          // Build comment body
          let body = `## Tarkeeba PR Review\n\n${result.summary}\n\n`;

          if (findings.length > 0) {
            const countText = selectedSet
              ? `${findings.length} selected of ${result.findings.length} total`
              : `${findings.length} total`;
            body += `### Findings (${countText})\n\n`;

            for (const f of findings) {
              const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' }[f.severity] || '⚪';
              body += `#### ${emoji} [${f.severity.toUpperCase()}] ${f.title}\n`;
              body += `📁 \`${f.file}:${f.line}\`\n\n`;
              body += `${f.description}\n\n`;
              const suggestedFix = f.suggestedFix?.trim();
              if (suggestedFix) {
                body += `**Suggested fix:**\n\`\`\`\n${suggestedFix}\n\`\`\`\n\n`;
              }
            }
          } else {
            body += `*No findings selected for this review.*\n\n`;
          }

          body += `---\n*This review was generated by Tarkeeba.*`;

          const encodedProject = encodeProjectName(config.project);

          // Post as comment to the PR
          await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}/threads`,
            {
              method: 'POST',
              body: JSON.stringify({
                comments: [{ content: body }],
                status: 1, // 1 = Active
              }),
            }
          );

          debugLog('Review comment posted successfully', { prId });

          // Update the stored review result with posted findings
          // Use atomic write with temp file to prevent race conditions
          const reviewPath = path.join(getAzureDevOpsDir(project), 'pr', `review_${prId}.json`);
          const tempPath = `${reviewPath}.tmp.${randomUUID()}`;
          try {
            const data = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'));
            data.has_posted_findings = true;
            const newPostedIds = findings.map(f => f.id);
            const existingPostedIds = data.posted_finding_ids || [];
            data.posted_finding_ids = [...new Set([...existingPostedIds, ...newPostedIds])];
            // Write to temp file first, then rename atomically
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tempPath, reviewPath);
            debugLog('Updated review result with posted findings', { prId, postedCount: newPostedIds.length });
          } catch (error) {
            // Clean up temp file if it exists
            try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
            debugLog('Failed to update review result file', { error: error instanceof Error ? error.message : error });
          }

          return true;
        } catch (error) {
          debugLog('Failed to post review', { prId, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return postResult ?? false;
    }
  );

  // Post comment to PR
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_POST_COMMENT,
    async (_, projectId: string, prId: number, body: string): Promise<boolean> => {
      debugLog('postPRComment handler called', { projectId, prId });
      const postResult = await withProjectOrNull(projectId, async (project) => {
        const config = await getAzureDevOpsConfig(project);
        if (!config) return false;

        try {
          await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}/threads`,
            {
              method: 'POST',
              body: JSON.stringify({
                comments: [{ content: body }],
                status: 1, // 1 = Active
              }),
            }
          );
          debugLog('Comment posted successfully', { prId });
          return true;
        } catch (error) {
          debugLog('Failed to post comment', { prId, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return postResult ?? false;
    }
  );

  // Merge PR
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_MERGE,
    async (_, projectId: string, prId: number, mergeMethod: 'squash' | 'rebase' | 'merge' = 'squash'): Promise<boolean> => {
      debugLog('mergePR handler called', { projectId, prId, mergeMethod });
      const mergeResult = await withProjectOrNull(projectId, async (project) => {
        const config = await getAzureDevOpsConfig(project);
        if (!config) return false;

        try {
          // Validate prId
          if (!Number.isInteger(prId) || prId <= 0) {
            throw new Error('Invalid PR ID');
          }

          // Determine merge options based on method
          const mergeOptions: Record<string, unknown> = {
            status: 3, // 3 = Completed
          };

          if (mergeMethod === 'squash') {
            mergeOptions.squashMerge = true;
          } else if (mergeMethod === 'rebase') {
            mergeOptions.rebaseMerge = true;
          }

          debugLog('Merging PR', { prId, method: mergeMethod, options: mergeOptions });

          await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}`,
            {
              method: 'PATCH',
              body: JSON.stringify(mergeOptions),
            }
          );

          debugLog('PR merged successfully', { prId });
          return true;
        } catch (error) {
          debugLog('Failed to merge PR', { prId, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return mergeResult ?? false;
    }
  );

  // Assign reviewers to PR
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_ASSIGN,
    async (_, projectId: string, prId: number, reviewerIds: string[]): Promise<boolean> => {
      debugLog('assignPR handler called', { projectId, prId, reviewerIds });
      const assignResult = await withProjectOrNull(projectId, async (project) => {
        const config = await getAzureDevOpsConfig(project);
        if (!config) return false;

        try {
          // In Azure DevOps, reviewers are added via the reviewers endpoint
          const reviewerUpdates = reviewerIds.map(id => ({
            id,
            vote: 0, // 0 = No vote (reviewer)
          }));

          await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}/reviewers`,
            {
              method: 'POST',
              body: JSON.stringify({ reviewers: reviewerUpdates }),
            }
          );
          debugLog('Reviewers assigned successfully', { prId, reviewerIds });
          return true;
        } catch (error) {
          debugLog('Failed to assign reviewers', { prId, reviewerIds, error: error instanceof Error ? error.message : error });
          return false;
        }
      });
      return assignResult ?? false;
    }
  );

  // Cancel PR review
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_CANCEL,
    async (_, projectId: string, prId: number): Promise<boolean> => {
      debugLog('cancelPRReview handler called', { projectId, prId });
      const reviewKey = getReviewKey(projectId, prId);
      const childProcess = runningReviews.get(reviewKey);

      if (!childProcess) {
        debugLog('No running review found to cancel', { reviewKey });
        return false;
      }

      try {
        debugLog('Killing review process', { reviewKey, pid: childProcess.pid });
        childProcess.kill('SIGTERM');

        setTimeout(() => {
          if (!childProcess.killed) {
            debugLog('Force killing review process', { reviewKey, pid: childProcess.pid });
            childProcess.kill('SIGKILL');
          }
        }, 1000);

        runningReviews.delete(reviewKey);
        debugLog('Review process cancelled', { reviewKey });
        return true;
      } catch (error) {
        debugLog('Failed to cancel review', { reviewKey, error: error instanceof Error ? error.message : error });
        return false;
      }
    }
  );

  // Check for new commits since last review
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_PR_CHECK_NEW_COMMITS,
    async (_, projectId: string, prId: number): Promise<NewCommitsCheck> => {
      debugLog('checkNewCommits handler called', { projectId, prId });

      const result = await withProjectOrNull(projectId, async (project) => {
        const azureDevOpsDir = path.join(project.path, '.auto-claude', 'azure-devops');
        const reviewPath = path.join(azureDevOpsDir, 'pr', `review_${prId}.json`);

        if (!fs.existsSync(reviewPath)) {
          return { hasNewCommits: false };
        }

        let review: PRReviewResult;
        try {
          const data = fs.readFileSync(reviewPath, 'utf-8');
          review = JSON.parse(data);
        } catch {
          return { hasNewCommits: false };
        }

        const reviewedCommitSha = review.reviewedCommitSha || (review as any).reviewed_commit_sha;
        if (!reviewedCommitSha) {
          debugLog('No reviewedCommitSha in review', { prId });
          return { hasNewCommits: false };
        }

        const config = await getAzureDevOpsConfig(project);
        if (!config) {
          return { hasNewCommits: false };
        }

        try {
          const encodedProject = encodeProjectName(config.project);
          const prData = await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}`
          ) as { sourceRefCommit?: { commitId: string }; lastMergeSourceCommit?: { commitId: string } };

          const currentHeadSha = prData.sourceRefCommit?.commitId || prData.lastMergeSourceCommit?.commitId;

          if (!currentHeadSha) {
            return { hasNewCommits: false };
          }

          if (reviewedCommitSha === currentHeadSha) {
            return {
              hasNewCommits: false,
              currentSha: currentHeadSha,
              reviewedSha: reviewedCommitSha,
            };
          }

          // Get commits to count new ones
          const commits = await azureDevOpsFetch(
            config.pat,
            config.organization,
            `/git/repositories/*/pullrequests/${prId}/commits`
          ) as { value: Array<{ commitId: string }> };

          // Find how many commits are after the reviewed one
          let newCommitCount = 0;
          if (commits.value) {
            for (const commit of commits.value) {
              if (commit.commitId === reviewedCommitSha) break;
              newCommitCount++;
            }
          }

          return {
            hasNewCommits: true,
            currentSha: currentHeadSha,
            reviewedSha: reviewedCommitSha,
            newCommitCount: newCommitCount || 1,
          };
        } catch (error) {
          debugLog('Error checking new commits', { prId, error: error instanceof Error ? error.message : error });
          return { hasNewCommits: false };
        }
      });

      return result ?? { hasNewCommits: false };
    }
  );

  // Run follow-up review
  ipcMain.on(
    IPC_CHANNELS.AZURE_DEVOPS_PR_FOLLOWUP_REVIEW,
    async (_, projectId: string, prId: number) => {
      debugLog('followupReview handler called', { projectId, prId });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      try {
        await withProjectOrNull(projectId, async (project) => {
          const { sendProgress, sendError, sendComplete } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
            mainWindow,
            {
              progress: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS,
              error: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR,
              complete: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE,
            },
            projectId
          );

          const validation = await validateAzureDevOpsModule(project);
          if (!validation.valid) {
            sendError({ prId, error: validation.error || 'Azure DevOps module validation failed' });
            return;
          }

          const backendPath = validation.backendPath!;
          const reviewKey = getReviewKey(projectId, prId);

          if (runningReviews.has(reviewKey)) {
            debugLog('Follow-up review already running', { reviewKey });
            return;
          }

          debugLog('Starting follow-up review', { prId });
          sendProgress({
            phase: 'fetching',
            prId,
            progress: 5,
            message: 'Starting follow-up review...',
          });

          const { model, thinkingLevel } = getAzureDevOpsSettings();
          const args = buildRunnerArgs(
            getAzureDevOpsRunnerPath(backendPath),
            project.path,
            'followup-review-pr',
            [prId.toString()],
            { model, thinkingLevel }
          );

          debugLog('Spawning follow-up review process', { args, model, thinkingLevel });

          // Get runner environment with PYTHONPATH for bundled packages (fixes #139)
          const followupSubprocessEnv = await getRunnerEnv();

          const { process: childProcess, promise } = runPythonSubprocess<PRReviewResult>({
            pythonPath: getPythonPath(backendPath),
            args,
            cwd: backendPath,
            env: followupSubprocessEnv,
            onProgress: (percent, message) => {
              debugLog('Progress update', { percent, message });
              sendProgress({
                phase: 'analyzing',
                prId,
                progress: percent,
                message,
              });
            },
            onStdout: (line) => debugLog('STDOUT:', line),
            onStderr: (line) => debugLog('STDERR:', line),
            onAuthFailure: (authFailureInfo: AuthFailureInfo) => {
              debugLog('Auth failure detected in follow-up PR review', authFailureInfo);
              mainWindow.webContents.send(IPC_CHANNELS.CLAUDE_AUTH_FAILURE, authFailureInfo);
            },
            onComplete: () => {
              const reviewResult = getReviewResult(project, prId);
              if (!reviewResult) {
                throw new Error('Follow-up review completed but result not found');
              }
              debugLog('Follow-up review result loaded', { findingsCount: reviewResult.findings.length });
              return reviewResult;
            },
          });

          runningReviews.set(reviewKey, childProcess);
          debugLog('Registered follow-up review process', { reviewKey, pid: childProcess.pid });

          try {
            const result = await promise;

            if (!result.success) {
              throw new Error(result.error ?? 'Follow-up review failed');
            }

            debugLog('Follow-up review completed', { prId, findingsCount: result.data?.findings.length });
            sendProgress({
              phase: 'complete',
              prId,
              progress: 100,
              message: 'Follow-up review complete!',
            });

            sendComplete(result.data!);
          } finally {
            runningReviews.delete(reviewKey);
            debugLog('Unregistered follow-up review process', { reviewKey });
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        debugLog('Follow-up review failed', { prId, error: errorMessage });
        const { sendError } = createIPCCommunicators<PRReviewProgress, PRReviewResult>(
          mainWindow,
          {
            progress: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_PROGRESS,
            error: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_ERROR,
            complete: IPC_CHANNELS.AZURE_DEVOPS_PR_REVIEW_COMPLETE,
          },
          projectId
        );
        sendError({ prId, error: `Follow-up review failed for PR #${prId}: ${errorMessage}` });
      }
    }
  );

  debugLog('PR review handlers registered');
}
