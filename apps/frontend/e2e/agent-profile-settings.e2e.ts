import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));

test.describe.serial('Agent profile phase settings', () => {
  let app: ElectronApplication;
  let page: Page;
  let testRoot: string;
  let userDataPath: string;
  let projectPath: string;

  async function launchApp(): Promise<void> {
    app = await electron.launch({
      args: [path.join(testFileDir, '..'), `--user-data-dir=${userDataPath}`],
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

    const applicationWindow = app.windows().find((window) => !window.url().includes('devtools'));
    if (!applicationWindow) {
      throw new Error('Tarkeeba application window did not open');
    }
    page = applicationWindow;
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => typeof window.electronAPI !== 'undefined');
  }

  test.beforeAll(async () => {
    testRoot = mkdtempSync(path.join(tmpdir(), 'tarkeeba-agent-profile-e2e-'));
    userDataPath = path.join(testRoot, 'user-data');
    projectPath = path.join(testRoot, 'profile-test-project');
    mkdirSync(path.join(projectPath, '.auto-claude', 'specs'), { recursive: true });
    writeFileSync(path.join(projectPath, 'README.md'), '# Profile test project\n');
    execFileSync('git', ['init'], { cwd: projectPath });
    execFileSync('git', ['config', 'user.name', 'Tarkeeba E2E'], { cwd: projectPath });
    execFileSync('git', ['config', 'user.email', 'e2e@tarkeeba.local'], { cwd: projectPath });
    execFileSync('git', ['add', 'README.md'], { cwd: projectPath });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: projectPath });

    await launchApp();

    const settingsResult = await page.evaluate(() => window.electronAPI.saveSettings({
      onboardingCompleted: true,
      selectedAgentProfile: 'complex',
      customPhaseModels: {
        spec: 'opus',
        planning: 'fable',
        coding: 'sonnet-5',
        qa: 'opus',
      },
      customPhaseThinking: {
        spec: 'high',
        planning: 'high',
        coding: 'high',
        qa: 'medium',
      },
    }));
    expect(settingsResult.success).toBe(true);

    const projectResult = await page.evaluate(
      (targetPath) => window.electronAPI.addProject(targetPath),
      projectPath,
    );
    expect(projectResult.success).toBe(true);

    // Restart the native app so the test verifies persisted IPC-backed settings,
    // not only the renderer's in-memory Zustand state.
    await app.close();
    await launchApp();
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(testRoot, { recursive: true, force: true });
  });

  test('preserves customized phases when Complex Tasks is reselected', async () => {
    const persistedSettings = await page.evaluate(() => window.electronAPI.getSettings());
    expect(persistedSettings.success).toBe(true);
    expect(persistedSettings.data?.selectedAgentProfile).toBe('complex');
    expect(persistedSettings.data?.customPhaseModels?.planning).toBe('fable');

    const newTaskButton = page.getByRole('button', { name: 'New Task', exact: true });
    await expect(newTaskButton).toBeEnabled();
    await newTaskButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const profileSelect = dialog.locator('#agent-profile');
    await expect(profileSelect).toContainText('Complex Tasks');

    const planningRow = dialog.getByText('Planning:', { exact: true }).locator('..');
    await expect(planningRow).toContainText('Fable 5');

    await profileSelect.click();
    await page.getByRole('option', { name: /Balanced/ }).click();
    await expect(planningRow).toContainText('Sonnet 5');

    await profileSelect.click();
    await page.getByRole('option', { name: /Complex Tasks/ }).click();
    await expect(planningRow).toContainText('Fable 5');
  });
});
