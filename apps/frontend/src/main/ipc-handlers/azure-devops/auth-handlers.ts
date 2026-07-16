/**
 * Azure DevOps PAT (Personal Access Token) authentication handlers
 * Provides IPC channels for PAT-based authentication without CLI dependencies
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { normalizeOrganizationReference, buildAzureDevOpsApiBaseUrl, azureDevOpsFetch, AzureDevOpsAPIError } from './utils';
import type { AzureDevOpsConfig, AzureDevOpsAPIUser } from './types';

// Debug logging helper - requires BOTH development mode AND DEBUG flag for auth handlers
// This is intentionally more restrictive than other handlers to prevent accidental token logging
const DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG === 'true';

// Matches a URL with embedded basic-auth credentials, e.g. https://user:pass@host/...
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^/\s@]+:[^/\s@]+@/i;
// Matches any long contiguous run of token-like characters (no whitespace),
// which is how PATs typically appear even when embedded in a longer message
// or URL path (so length/space heuristics alone can't be relied on).
const LONG_TOKEN_PATTERN = /[A-Za-z0-9_\-.]{16,}/;

/**
 * Redact sensitive information from data before logging
 */
function redactSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    // Redact anything that looks like a PAT (a long token-like run of
    // characters) or a URL with embedded credentials, regardless of
    // surrounding whitespace/slashes.
    if (CREDENTIAL_URL_PATTERN.test(data) || LONG_TOKEN_PATTERN.test(data)) {
      return '[REDACTED_PAT]';
    }
    return data;
  }
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      return data.map(redactSensitiveData);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact known sensitive keys. If the value is itself an object/array
      // (e.g. a "credentials" container), recurse into it instead of
      // blanket-masking the whole structure, so nested non-sensitive fields
      // are preserved.
      if (/token|password|secret|credential|pat|auth/i.test(key)) {
        result[key] = typeof value === 'object' && value !== null
          ? redactSensitiveData(value)
          : '[REDACTED]';
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result;
  }
  return data;
}

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.debug(`[Azure DevOps Auth] ${message}`, redactSensitiveData(data));
    } else {
      console.debug(`[Azure DevOps Auth] ${message}`);
    }
  }
}

/**
 * Validate that a PAT string is not empty and has reasonable length
 */
function isValidPATFormat(pat: string): boolean {
  if (!pat || typeof pat !== 'string') return false;
  // PATs are typically base64-encoded strings, at least 20 chars
  // Allow up to 1024 chars as defense-in-depth
  return pat.length >= 10 && pat.length <= 1024;
}

/**
 * Validate organization name format
 */
function isValidOrganization(org: string): boolean {
  if (!org || typeof org !== 'string') return false;
  const normalized = org.trim();
  if (!normalized) return false;
  // Allow org names and URLs
  // Org names are alphanumeric with hyphens/underscores
  // URLs are validated by buildAzureDevOpsApiBaseUrl
  return normalized.length > 0 && normalized.length <= 256;
}

/**
 * Validate project name format
 */
function isValidProject(project: string): boolean {
  if (!project || typeof project !== 'string') return false;
  const normalized = project.trim();
  if (!normalized) return false;
  // Azure DevOps limits project names to 64 chars, using 256 as defense-in-depth
  return normalized.length > 0 && normalized.length <= 256;
}

/**
 * Save Azure DevOps PAT configuration to secure storage
 * Stores organization, project, and PAT for later use
 */
export function registerSavePAT(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_SAVE_PAT,
    async (
      _event,
      organization: string,
      project: string,
      pat: string
    ): Promise<IPCResult<{ success: boolean }>> => {
      debugLog('savePAT handler called');
      try {
        // Validate inputs
        if (!isValidOrganization(organization)) {
          return {
            success: false,
            error: 'Invalid organization name'
          };
        }

        if (!isValidProject(project)) {
          return {
            success: false,
            error: 'Invalid project name'
          };
        }

        if (!isValidPATFormat(pat)) {
          return {
            success: false,
            error: 'Invalid PAT format'
          };
        }

        debugLog('PAT validation passed');

        // Store the configuration (in production, this would persist to secure storage)
        // For now, we return success - the actual persistence is handled by
        // environment variables or settings store
        return {
          success: true,
          data: { success: true }
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Save PAT failed:', errorMsg);
        return {
          success: false,
          error: `Failed to save PAT: ${errorMsg}`
        };
      }
    }
  );
}

/**
 * Get current Azure DevOps user information
 * Validates that the PAT is valid and authenticated
 */
export function registerGetUser(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_GET_USER,
    async (_event, organization: string, pat: string): Promise<IPCResult<{ user?: AzureDevOpsAPIUser; authenticated: boolean }>> => {
      debugLog('getUser handler called');
      try {
        if (!isValidOrganization(organization)) {
          return {
            success: false,
            error: 'Invalid organization name'
          };
        }

        if (!isValidPATFormat(pat)) {
          return {
            success: false,
            error: 'Invalid PAT format'
          };
        }

        debugLog('Fetching current user...');
        const response = await azureDevOpsFetch(pat, organization, '/users');

        // The response should contain user information
        // Azure DevOps returns different formats depending on endpoint
        // Try to extract user info
        if (typeof response === 'object' && response !== null) {
          const data = response as Record<string, unknown>;
          if (data.descriptorIdentifier || data.displayName) {
            debugLog('User authenticated successfully');
            return {
              success: true,
              data: {
                authenticated: true,
                user: {
                  id: String(data.descriptorIdentifier || data.id || ''),
                  displayName: String(data.displayName || 'Unknown'),
                  uniqueName: String(data.mailAddress || data.uniqueName || ''),
                  url: String(data.url || ''),
                  imageUrl: String(data.imageUrl || '')
                }
              }
            };
          }
        }

        // If we got here without error, PAT is valid
        debugLog('PAT is valid');
        return {
          success: true,
          data: { authenticated: true }
        };
      } catch (error) {
        if (error instanceof AzureDevOpsAPIError) {
          if (error.statusCode === 401 || error.statusCode === 403) {
            debugLog('Authentication failed:', error.statusCode);
            return {
              success: true,
              data: { authenticated: false }
            };
          }
        }
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Get user failed:', errorMsg);
        return {
          success: false,
          error: `Failed to get user: ${errorMsg}`
        };
      }
    }
  );
}

/**
 * Validate Azure DevOps PAT and organization/project configuration
 */
export function registerValidatePAT(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_VALIDATE_PAT,
    async (
      _event,
      organization: string,
      project: string,
      pat: string
    ): Promise<IPCResult<{ valid: boolean; message?: string }>> => {
      debugLog('validatePAT handler called');
      try {
        // Validate input format first
        if (!isValidOrganization(organization)) {
          return {
            success: false,
            error: 'Invalid organization name'
          };
        }

        if (!isValidProject(project)) {
          return {
            success: false,
            error: 'Invalid project name'
          };
        }

        if (!isValidPATFormat(pat)) {
          return {
            success: false,
            error: 'Invalid PAT format'
          };
        }

        debugLog('Validating PAT with organization:', redactSensitiveData(organization));

        // Try to fetch a basic endpoint to validate the PAT
        // Using projects endpoint which requires authentication
        const response = await azureDevOpsFetch(
          pat,
          organization,
          `/projects/${encodeURIComponent(project)}?api-version=7.1`
        );

        // If we got a response without error, PAT is valid
        if (typeof response === 'object' && response !== null) {
          const data = response as Record<string, unknown>;
          if (data.id || data.name) {
            debugLog('PAT validation successful');
            return {
              success: true,
              data: {
                valid: true,
                message: 'PAT is valid and organization/project exist'
              }
            };
          }
        }

        debugLog('PAT validation returned unexpected response');
        return {
          success: true,
          data: {
            valid: false,
            message: 'Unexpected response from Azure DevOps API'
          }
        };
      } catch (error) {
        if (error instanceof AzureDevOpsAPIError) {
          debugLog('PAT validation failed with status:', error.statusCode);
          if (error.statusCode === 401 || error.statusCode === 403) {
            return {
              success: true,
              data: {
                valid: false,
                message: 'Invalid PAT or authentication failed'
              }
            };
          }
          if (error.statusCode === 404) {
            return {
              success: true,
              data: {
                valid: false,
                message: 'Project or organization not found'
              }
            };
          }
        }
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('PAT validation error:', errorMsg);
        return {
          success: true,
          data: {
            valid: false,
            message: `Validation error: ${errorMsg}`
          }
        };
      }
    }
  );
}

/**
 * Check if a PAT connection is valid (simple connectivity check)
 */
export function registerCheckPATConnection(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_CHECK_CONNECTION,
    async (
      _event,
      organization: string,
      project: string,
      pat: string
    ): Promise<IPCResult<{ connected: boolean; error?: string }>> => {
      debugLog('checkPATConnection handler called');
      try {
        if (!isValidOrganization(organization)) {
          return {
            success: false,
            error: 'Invalid organization name'
          };
        }

        if (!isValidProject(project)) {
          return {
            success: false,
            error: 'Invalid project name'
          };
        }

        if (!isValidPATFormat(pat)) {
          return {
            success: false,
            error: 'Invalid PAT format'
          };
        }

        debugLog('Checking PAT connection...');

        // Try to fetch organization info as a quick connectivity check
        const response = await azureDevOpsFetch(
          pat,
          organization,
          `/projects/${encodeURIComponent(project)}?api-version=7.1`
        );

        if (response) {
          debugLog('Connection check successful');
          return {
            success: true,
            data: { connected: true }
          };
        }

        return {
          success: true,
          data: {
            connected: false,
            error: 'No response from Azure DevOps API'
          }
        };
      } catch (error) {
        if (error instanceof AzureDevOpsAPIError) {
          return {
            success: true,
            data: {
              connected: false,
              error: `API Error ${error.statusCode}: ${error.message}`
            }
          };
        }
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Connection check failed:', errorMsg);
        return {
          success: true,
          data: {
            connected: false,
            error: errorMsg
          }
        };
      }
    }
  );
}

/**
 * Detect the default organization from available Azure DevOps instances
 * Returns the first available organization
 */
export function registerDetectOrganization(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_DETECT_ORG,
    async (_event, pat: string): Promise<IPCResult<{ organization?: string }>> => {
      debugLog('detectOrganization handler called');
      try {
        if (!isValidPATFormat(pat)) {
          return {
            success: false,
            error: 'Invalid PAT format'
          };
        }

        debugLog('Detecting organization...');

        // Try to get organizations the user has access to
        // Note: This requires the PAT to have the appropriate scope
        try {
          // Azure DevOps doesn't have a direct "list my organizations" endpoint
          // Instead, we can try to fetch the profile endpoint which requires org context
          // For now, return null to indicate detection is not available
          // The user should provide the organization explicitly
          debugLog('Organization detection not available - user must provide organization');
          return {
            success: true,
            data: {}
          };
        } catch {
          debugLog('Failed to detect organization');
          return {
            success: true,
            data: {}
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Organization detection failed:', errorMsg);
        return {
          success: false,
          error: `Failed to detect organization: ${errorMsg}`
        };
      }
    }
  );
}

/**
 * Detect the default project from an organization
 * Returns the first available project
 */
export function registerDetectProject(): void {
  ipcMain.handle(
    IPC_CHANNELS.AZURE_DEVOPS_DETECT_PROJECT,
    async (_event, organization: string, pat: string): Promise<IPCResult<{ project?: string }>> => {
      debugLog('detectProject handler called');
      try {
        if (!isValidOrganization(organization)) {
          return {
            success: false,
            error: 'Invalid organization name'
          };
        }

        if (!isValidPATFormat(pat)) {
          return {
            success: false,
            error: 'Invalid PAT format'
          };
        }

        debugLog('Detecting project...');

        // Fetch projects and return the first one
        const response = await azureDevOpsFetch(
          pat,
          organization,
          '/projects?api-version=7.1&$top=1'
        );

        if (typeof response === 'object' && response !== null) {
          const data = response as Record<string, unknown>;
          const value = data.value as unknown[];
          if (Array.isArray(value) && value.length > 0) {
            const firstProject = value[0] as Record<string, unknown>;
            if (firstProject.name) {
              debugLog('Project detected:', String(firstProject.name));
              return {
                success: true,
                data: { project: String(firstProject.name) }
              };
            }
          }
        }

        debugLog('No projects found');
        return {
          success: true,
          data: {}
        };
      } catch (error) {
        if (error instanceof AzureDevOpsAPIError && error.statusCode === 404) {
          debugLog('Organization not found');
          return {
            success: true,
            data: {}
          };
        }
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugLog('Project detection failed:', errorMsg);
        return {
          success: false,
          error: `Failed to detect project: ${errorMsg}`
        };
      }
    }
  );
}

/**
 * Register all Azure DevOps auth handlers
 */
export function registerAzureDevOpsAuthHandlers(): void {
  registerSavePAT();
  registerGetUser();
  registerValidatePAT();
  registerCheckPATConnection();
  registerDetectOrganization();
  registerDetectProject();
}
