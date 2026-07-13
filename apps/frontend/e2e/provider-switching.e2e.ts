import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));

test.describe.serial('Claude and Codex provider switching', () => {
  let app: ElectronApplication;
  let page: Page;
  let testRoot: string;

  test.beforeAll(async () => {
    testRoot = mkdtempSync(path.join(tmpdir(), 'auto-claude-provider-e2e-'));
    app = await electron.launch({
      args: [path.join(testFileDir, '..'), `--user-data-dir=${path.join(testRoot, 'user-data')}`],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.closeDevTools();
      }
    });
    await app.firstWindow();
    await expect.poll(async () => {
      for (const window of app.windows()) {
        if (await window.evaluate(() => typeof window.electronAPI !== 'undefined').catch(() => false)) {
          return true;
        }
      }
      return false;
    }).toBe(true);
    page = app.windows().find((window) => !window.url().includes('devtools'))!;
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.electronAPI !== 'undefined');
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(testRoot, { recursive: true, force: true });
  });

  test('isolates the E2E application identity and data directory', async () => {
    const identity = await app.evaluate(({ app: electronApp }) => ({
      name: electronApp.getName(),
      userData: electronApp.getPath('userData'),
    }));

    expect(identity.name).toBe('Tarkeeba E2E');
    expect(identity.userData).toBe(realpathSync(path.join(testRoot, 'user-data')));
  });

  test('isolates the development application identity from production', async () => {
    const devUserData = path.join(testRoot, 'dev-user-data');
    const devApp = await electron.launch({
      args: [path.join(testFileDir, '..')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_USER_DATA_PATH: devUserData,
      },
    });

    try {
      const identity = await devApp.evaluate(({ app: electronApp }) => ({
        name: electronApp.getName(),
        userData: electronApp.getPath('userData'),
      }));

      expect(identity.name).toBe('Tarkeeba Dev');
      expect(identity.userData).toBe(devUserData);
    } finally {
      await devApp.close();
    }
  });

  test('preserves initialization errors from the backend', async () => {
    const projectPath = path.join(testRoot, 'not-a-git-repository');
    mkdirSync(projectPath, { recursive: true });

    const addResult = await page.evaluate((targetPath) => window.electronAPI.addProject(targetPath), projectPath);
    expect(addResult.success).toBe(true);
    expect(addResult.data).toBeTruthy();

    const result = await page.evaluate((projectId) => window.electronAPI.initializeProject(projectId), addResult.data!.id);
    expect(result.success).toBe(false);
    expect(result.data?.success).toBe(false);
    expect(result.data?.error).toContain('Initialize Git and create an initial commit');

  });

  test('switches from Codex back to Claude and restores the usage control', async () => {
    const profile = await page.evaluate(() => window.electronAPI.createOpenAIProfile('E2E Main Account'));
    expect(profile.success).toBe(true);

    await page.evaluate(() => localStorage.setItem('auto-claude:agent-provider', 'codex'));
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('button', { name: 'Skip Setup' }).click();

    const agentSelector = page.getByRole('combobox', { name: 'Active coding agent' });
    await expect(agentSelector).toContainText('Codex: E2E Main Account');
    const usageControl = page.getByRole('button', {
      name: /Usage status|Usage data unavailable|Re-authentication required/,
    });
    await expect(usageControl).toHaveCount(0);

    await agentSelector.click();
    await page.getByRole('option', { name: /Claude Code/ }).click();

    await expect(agentSelector).toContainText('Claude Code');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('auto-claude:agent-provider'))).toBe('claude');
    await expect(usageControl).toBeVisible();
  });
});
