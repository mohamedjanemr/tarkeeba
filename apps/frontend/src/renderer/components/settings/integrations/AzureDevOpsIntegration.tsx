import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Loader2, CheckCircle2, AlertCircle, Lock, Globe, ChevronDown } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Separator } from '../../ui/separator';
import { Button } from '../../ui/button';
import { PasswordInput } from '../../project-settings/PasswordInput';
import type { ProjectEnvConfig, ProjectSettings } from '../../../../shared/types';

// Debug logging
const DEBUG = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';
function debugLog(message: string, data?: unknown) {
  if (DEBUG) {
    if (data !== undefined) {
      console.warn(`[AzureDevOpsIntegration] ${message}`, data);
    } else {
      console.warn(`[AzureDevOpsIntegration] ${message}`);
    }
  }
}

interface AzureDevOpsProject {
  name: string;
  id: string;
  description: string | null;
  visibility: string;
}

interface AzureDevOpsIntegrationProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  showAzureDevOpsToken: boolean;
  setShowAzureDevOpsToken: React.Dispatch<React.SetStateAction<boolean>>;
  azureDevOpsConnectionStatus: any; // Will be defined once backend types are complete
  isCheckingAzureDevOps: boolean;
  projectPath?: string;
  // Project settings for mainBranch
  settings?: ProjectSettings;
  setSettings?: React.Dispatch<React.SetStateAction<ProjectSettings>>;
}

/**
 * Azure DevOps integration settings component.
 * Manages Azure DevOps Personal Access Token (PAT), organization, and project configuration.
 */
export function AzureDevOpsIntegration({
  envConfig,
  updateEnvConfig,
  showAzureDevOpsToken: _showAzureDevOpsToken,
  setShowAzureDevOpsToken: _setShowAzureDevOpsToken,
  azureDevOpsConnectionStatus,
  isCheckingAzureDevOps,
  projectPath,
  settings,
  setSettings
}: AzureDevOpsIntegrationProps) {
  const { t } = useTranslation('azure-devops');
  const [projects, setProjects] = useState<AzureDevOpsProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Branch selection state
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  // Type assertion for Azure DevOps fields
  const config = envConfig as any;

  debugLog('Render - projectPath:', projectPath);
  debugLog('Render - envConfig:', envConfig ? { azureDevOpsEnabled: (envConfig as any).azureDevOpsEnabled, hasToken: !!(envConfig as any).azureDevOpsToken, defaultBranch: envConfig.defaultBranch } : null);

  // Fetch branches when Azure DevOps is enabled and project path is available
  useEffect(() => {
    const azureEnabled = (envConfig as any)?.azureDevOpsEnabled;
    debugLog(`useEffect[branches] - azureDevOpsEnabled: ${azureEnabled}, projectPath: ${projectPath}`);
    if (azureEnabled && projectPath) {
      debugLog('useEffect[branches] - Triggering fetchBranches');
      fetchBranches();
    } else {
      debugLog('useEffect[branches] - Skipping fetchBranches (conditions not met)');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(envConfig as any)?.azureDevOpsEnabled, projectPath]);

  /**
   * Handler for branch selection changes.
   * Updates BOTH project.settings.mainBranch (for Electron app) and envConfig.defaultBranch (for CLI backward compatibility).
   */
  const handleBranchChange = (branch: string) => {
    debugLog('handleBranchChange: Updating branch to:', branch);

    // Update project settings (primary source for Electron app)
    if (setSettings) {
      setSettings(prev => ({ ...prev, mainBranch: branch }));
      debugLog('handleBranchChange: Updated settings.mainBranch');
    }

    // Also update envConfig for CLI backward compatibility
    updateEnvConfig({ defaultBranch: branch });
    debugLog('handleBranchChange: Updated envConfig.defaultBranch');
  };

  const fetchBranches = async () => {
    if (!projectPath) {
      debugLog('fetchBranches: No projectPath, skipping');
      return;
    }

    debugLog('fetchBranches: Starting with projectPath:', projectPath);
    setIsLoadingBranches(true);
    setBranchesError(null);

    try {
      debugLog('fetchBranches: Calling getGitBranches...');
      const result = await window.electronAPI.getGitBranches(projectPath);
      debugLog('fetchBranches: getGitBranches result:', { success: result.success, dataType: typeof result.data, dataLength: Array.isArray(result.data) ? result.data.length : 'N/A', error: result.error });

      if (result.success && result.data) {
        setBranches(result.data);
        debugLog('fetchBranches: Loaded branches:', result.data.length);

        // Auto-detect default branch if not set in project settings
        // Priority: settings.mainBranch > envConfig.defaultBranch > auto-detect
        if (!settings?.mainBranch && !envConfig?.defaultBranch) {
          debugLog('fetchBranches: No branch set, auto-detecting...');
          const detectResult = await window.electronAPI.detectMainBranch(projectPath);
          debugLog('fetchBranches: detectMainBranch result:', detectResult);
          if (detectResult.success && detectResult.data) {
            debugLog('fetchBranches: Auto-detected default branch:', detectResult.data);
            handleBranchChange(detectResult.data);
          }
        }
      } else {
        debugLog('fetchBranches: Failed -', result.error || 'No data returned');
        setBranchesError(result.error || 'Failed to load branches');
      }
    } catch (err) {
      debugLog('fetchBranches: Exception:', err);
      setBranchesError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setIsLoadingBranches(false);
    }
  };

  if (!envConfig) {
    debugLog('No envConfig, returning null');
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="font-normal text-foreground">{t('settings.enableIssues')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.enableIssuesDescription')}
          </p>
        </div>
        <Switch
          checked={config.azureDevOpsEnabled || false}
          onCheckedChange={(checked) => updateEnvConfig({ azureDevOpsEnabled: checked } as any)}
        />
      </div>

      {config.azureDevOpsEnabled && (
        <>
          {/* Organization URL */}
          <OrganizationInput
            value={config.azureDevOpsOrganization || ''}
            onChange={(value) => updateEnvConfig({ azureDevOpsOrganization: value } as any)}
          />

          {/* Project Input */}
          <ProjectInput
            value={config.azureDevOpsProject || ''}
            onChange={(value) => updateEnvConfig({ azureDevOpsProject: value } as any)}
          />

          {/* Personal Access Token */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">{t('settings.personalAccessToken')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.tokenScope')} <code className="px-1 bg-muted rounded">{t('settings.scopeApi')}</code> {t('settings.scopeFrom')}{' '}
              <a
                href="https://dev.azure.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline"
              >
                {t('settings.gitlabSettings')}
              </a>
            </p>
            <PasswordInput
              value={config.azureDevOpsToken || ''}
              onChange={(value) => updateEnvConfig({ azureDevOpsToken: value } as any)}
              placeholder="••••••••••••••••••••••••"
            />
          </div>

          {config.azureDevOpsToken && config.azureDevOpsOrganization && config.azureDevOpsProject && (
            <ConnectionStatus
              isChecking={isCheckingAzureDevOps}
              connectionStatus={azureDevOpsConnectionStatus}
            />
          )}

          {azureDevOpsConnectionStatus?.connected && <WorkItemsAvailableInfo />}

          <Separator />

          {/* Default Branch Selector */}
          {projectPath && (
            <BranchSelector
              branches={branches}
              selectedBranch={settings?.mainBranch || config.defaultBranch || ''}
              isLoading={isLoadingBranches}
              error={branchesError}
              onSelect={handleBranchChange}
              onRefresh={fetchBranches}
            />
          )}

          <Separator />

          <AutoSyncToggle
            enabled={config.azureDevOpsAutoSync || false}
            onToggle={(checked) => updateEnvConfig({ azureDevOpsAutoSync: checked } as any)}
          />
        </>
      )}
    </div>
  );
}

interface OrganizationInputProps {
  value: string;
  onChange: (value: string) => void;
}

function OrganizationInput({ value, onChange }: OrganizationInputProps) {
  const { t } = useTranslation('azure-devops');

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{t('settings.instance')}</Label>
      <p className="text-xs text-muted-foreground">
        {t('settings.instanceDescription')}
      </p>
      <Input
        placeholder="https://dev.azure.com/your-org"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface ProjectInputProps {
  value: string;
  onChange: (value: string) => void;
}

function ProjectInput({ value, onChange }: ProjectInputProps) {
  const { t } = useTranslation('azure-devops');

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{t('settings.project')}</Label>
      <p className="text-xs text-muted-foreground">
        {t('settings.projectFormat')} <code className="px-1 bg-muted rounded">ProjectName</code> {t('settings.projectFormatExample')}
      </p>
      <Input
        placeholder="ProjectName"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface ConnectionStatusProps {
  isChecking: boolean;
  connectionStatus: any;
}

function ConnectionStatus({ isChecking, connectionStatus }: ConnectionStatusProps) {
  const { t } = useTranslation('azure-devops');

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{t('settings.connectionStatus')}</p>
          <p className="text-xs text-muted-foreground">
            {isChecking ? t('settings.checking') :
              connectionStatus?.connected
                ? `${t('settings.connectedTo')} ${connectionStatus.projectName}`
                : connectionStatus?.error || t('settings.notConnected')}
          </p>
        </div>
        {isChecking ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : connectionStatus?.connected ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 text-warning" />
        )}
      </div>
    </div>
  );
}

function WorkItemsAvailableInfo() {
  const { t } = useTranslation('azure-devops');

  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex items-start gap-3">
        <svg className="h-5 w-5 text-info mt-0.5" viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="azure-devops-icon-title">
          <title id="azure-devops-icon-title">Azure DevOps</title>
          <path d="M2 2h8v8H2V2zm12 0h8v8h-8V2zM2 14h8v8H2v-8zm12 0h8v8h-8v-8z"/>
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{t('settings.issuesAvailable')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('settings.issuesAvailableDescription')}
          </p>
        </div>
      </div>
    </div>
  );
}

interface AutoSyncToggleProps {
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}

function AutoSyncToggle({ enabled, onToggle }: AutoSyncToggleProps) {
  const { t } = useTranslation('azure-devops');

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-info" />
          <Label className="font-normal text-foreground">{t('settings.autoSyncOnLoad')}</Label>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          {t('settings.autoSyncDescription')}
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

interface BranchSelectorProps {
  branches: string[];
  selectedBranch: string;
  isLoading: boolean;
  error: string | null;
  onSelect: (branch: string) => void;
  onRefresh: () => void;
}

function BranchSelector({
  branches,
  selectedBranch,
  isLoading,
  error,
  onSelect,
  onRefresh
}: BranchSelectorProps) {
  const { t } = useTranslation('azure-devops');
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filteredBranches = branches.filter(branch =>
    branch.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium text-foreground">{t('settings.defaultBranch')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.defaultBranchDescription')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="h-7 px-2"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isLoading}
          className="w-full flex items-center justify-between px-3 py-2 text-sm border border-input rounded-md bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('settings.loadingBranches')}
            </span>
          ) : selectedBranch ? (
            <span className="flex items-center gap-2">
              {selectedBranch}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('settings.autoDetect')}</span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && !isLoading && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-64 overflow-hidden">
            <div className="p-2 border-b border-border">
              <Input
                placeholder={t('settings.searchBranches')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>

            <button
              type="button"
              onClick={() => {
                onSelect('');
                setIsOpen(false);
                setFilter('');
              }}
              className={`w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2 ${
                !selectedBranch ? 'bg-accent' : ''
              }`}
            >
              <span className="text-sm text-muted-foreground italic">{t('settings.autoDetect')}</span>
            </button>

            <div className="max-h-40 overflow-y-auto border-t border-border">
              {filteredBranches.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {filter ? t('settings.noMatchingBranches') : t('settings.noBranchesFound')}
                </div>
              ) : (
                filteredBranches.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    onClick={() => {
                      onSelect(branch);
                      setIsOpen(false);
                      setFilter('');
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2 ${
                      branch === selectedBranch ? 'bg-accent' : ''
                    }`}
                  >
                    <span className="text-sm">{branch}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {selectedBranch && (
        <p className="text-xs text-muted-foreground">
          {t('settings.branchFromNote')} <code className="px-1 bg-muted rounded">{selectedBranch}</code>
        </p>
      )}
    </div>
  );
}
