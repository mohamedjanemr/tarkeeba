/**
 * Azure DevOps utility functions
 */

import { readFile, access } from 'fs/promises';
import { execFileSync } from 'child_process';
import path from 'path';
import type { Project } from '../../../shared/types';
import { parseEnvFile } from '../utils';
import type { AzureDevOpsConfig } from './types';
import { getAugmentedEnv } from '../../env-utils';
import { getIsolatedGitEnv } from '../../utils/git-isolation';

const DEFAULT_AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com';

/**
 * Custom error class for Azure DevOps API errors with structured status code
 */
export class AzureDevOpsAPIError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AzureDevOpsAPIError';
    this.statusCode = statusCode;
  }
}

function parseOrganizationUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;

  // If it looks like just an org name (no slashes), assume it's a dev.azure.com org
  if (!candidate.includes('/')) {
    return candidate;
  }

  // If it's a full URL, extract and validate
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }

    // Extract organization name from URL path
    // https://dev.azure.com/myorg -> myorg
    // https://myazureinstance.visualstudio.com/myorg -> myorg
    const pathParts = parsed.pathname.split('/').filter((p) => p.length > 0);
    if (pathParts.length > 0) {
      return pathParts[0];
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeOrganization(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate) return null;

  // If it's a full URL, extract the org name
  if (candidate.includes('://')) {
    return parseOrganizationUrl(candidate);
  }

  // Otherwise, assume it's an org name
  return candidate.length > 0 ? candidate : null;
}

function sanitizeToken(value: string | undefined): string | null {
  if (!value) return null;
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1F || code === 0x7F) {
      continue;
    }
    sanitized += value[i];
  }
  const trimmed = sanitized.trim();
  if (!trimmed) return null;
  return trimmed.length > 1024 ? trimmed.substring(0, 1024) : trimmed;
}

// Max length for project names
// Azure DevOps limits project names to 64 chars, using 256 as defense-in-depth
const MAX_PROJECT_NAME_LENGTH = 256;

function sanitizeProjectName(value: string | undefined): string | null {
  if (!value) return null;
  let sanitized = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1F || code === 0x7F) {
      continue;
    }
    sanitized += value[i];
  }
  const trimmed = sanitized.trim();
  if (!trimmed) return null;
  // Reject excessively long inputs as defense-in-depth
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) return null;
  return trimmed;
}

/**
 * Get Azure DevOps PAT from Azure CLI if available
 * Uses augmented PATH to find az CLI in common locations
 */
function getTokenFromAzCli(organization?: string): string | null {
  try {
    const args = ['account', 'show', '--query', 'user.name', '-o', 'json'];

    const output = execFileSync('az', args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getAugmentedEnv()
    }).trim();

    // If we can run az commands, try to get the PAT
    // Note: Azure CLI doesn't directly output PAT, but we can check if authenticated
    if (output) {
      return null; // PAT retrieval requires different approach
    }
    return null;
  } catch {
    return null;
  }
}

// Azure DevOps environment variable keys (must match env-handlers.ts)
const AZURE_DEVOPS_ENV_KEYS = {
  ENABLED: 'AZURE_DEVOPS_ENABLED',
  PAT: 'AZURE_DEVOPS_PAT',
  ORGANIZATION: 'AZURE_DEVOPS_ORG',
  PROJECT: 'AZURE_DEVOPS_PROJECT'
} as const;

const LEGACY_AZURE_DEVOPS_ENV_KEYS = {
  PAT: 'AZURE_DEVOPS_TOKEN',
  ORGANIZATION: 'AZURE_DEVOPS_ORGANIZATION'
} as const;

/**
 * Check if a file exists (async)
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Azure DevOps configuration from project environment file
 * Returns null if Azure DevOps is explicitly disabled via AZURE_DEVOPS_ENABLED=false
 */
export async function getAzureDevOpsConfig(project: Project): Promise<AzureDevOpsConfig | null> {
  if (!project.autoBuildPath) return null;
  const envPath = path.join(project.path, project.autoBuildPath, '.env');
  if (!(await fileExists(envPath))) return null;

  try {
    const content = await readFile(envPath, 'utf-8');
    const vars = parseEnvFile(content);

    // Check if Azure DevOps is explicitly disabled
    if (vars[AZURE_DEVOPS_ENV_KEYS.ENABLED]?.toLowerCase() === 'false') {
      return null;
    }

    const pat = sanitizeToken(
      vars[AZURE_DEVOPS_ENV_KEYS.PAT] || vars[LEGACY_AZURE_DEVOPS_ENV_KEYS.PAT]
    );
    const projectName = sanitizeProjectName(vars[AZURE_DEVOPS_ENV_KEYS.PROJECT]);
    const organization = normalizeOrganization(
      vars[AZURE_DEVOPS_ENV_KEYS.ORGANIZATION]
        || vars[LEGACY_AZURE_DEVOPS_ENV_KEYS.ORGANIZATION]
    );

    if (!pat || !projectName || !organization) return null;

    return { pat, organization, project: projectName };
  } catch {
    return null;
  }
}

/**
 * Normalize an Azure DevOps organization reference
 * Handles:
 * - myorg (org name)
 * - https://dev.azure.com/myorg
 * - https://myazureinstance.visualstudio.com/myorg
 */
export function normalizeOrganizationReference(organization: string, baseUrl: string = DEFAULT_AZURE_DEVOPS_ORG_URL): string {
  if (!organization) return '';

  // If it's a full URL, extract the org name
  if (organization.includes('://')) {
    const parsed = parseOrganizationUrl(organization);
    return parsed || organization;
  }

  // Otherwise, assume it's an org name
  return organization.trim();
}

/**
 * URL-encode an Azure DevOps project name for API calls
 * Azure DevOps API requires project names to be URL-encoded
 */
export function encodeProjectName(projectName: string): string {
  return encodeURIComponent(projectName);
}

/**
 * Build the base API URL for an Azure DevOps organization
 */
export function buildAzureDevOpsApiBaseUrl(organization: string, baseUrl: string = DEFAULT_AZURE_DEVOPS_ORG_URL): string {
  const normalizedOrg = normalizeOrganizationReference(organization, baseUrl);
  return `${baseUrl}/${normalizedOrg}`;
}

function buildAzureDevOpsEndpointUrl(
  organization: string,
  endpoint: string,
  baseUrl: string
): string {
  const organizationBase = buildAzureDevOpsApiBaseUrl(organization, baseUrl);
  // Some APIs are organization-scoped (`/_apis/...`) while project-scoped
  // APIs include `/{project}/_apis/...`. Other callers pass the portion after
  // `_apis`; retain that shorthand for the common organization-scoped case.
  return endpoint.includes('/_apis/') || endpoint.startsWith('/_apis')
    ? `${organizationBase}${endpoint}`
    : `${organizationBase}/_apis${endpoint}`;
}

// Default timeout for Azure DevOps API requests (30 seconds)
const AZURE_DEVOPS_API_TIMEOUT_MS = 30000;

/**
 * Make a request to the Azure DevOps API with timeout
 * Supports both dev.azure.com and on-premises Azure DevOps
 */
export async function azureDevOpsFetch(
  pat: string,
  organization: string,
  endpoint: string,
  options: RequestInit = {},
  baseUrl: string = DEFAULT_AZURE_DEVOPS_ORG_URL
): Promise<unknown> {
  const safePat = sanitizeToken(pat);
  if (!safePat) {
    throw new Error('Invalid Azure DevOps PAT');
  }

  const normalizedOrg = normalizeOrganizationReference(organization, baseUrl);
  if (!normalizedOrg) {
    throw new Error('Invalid Azure DevOps organization');
  }

  if (!endpoint.startsWith('/')) {
    throw new Error('Azure DevOps endpoint must be a relative path');
  }

  const url = buildAzureDevOpsEndpointUrl(normalizedOrg, endpoint, baseUrl);

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AZURE_DEVOPS_API_TIMEOUT_MS);

  try {
    // Azure DevOps uses Basic authentication with PAT
    const authHeader = `Basic ${Buffer.from(`:${safePat}`).toString('base64')}`;

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: authHeader
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new AzureDevOpsAPIError(
        `Azure DevOps API error: ${response.status} ${response.statusText} - ${errorBody}`,
        response.status
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AzureDevOpsAPIError(
        `Azure DevOps API timeout after ${AZURE_DEVOPS_API_TIMEOUT_MS / 1000}s: ${url}`,
        0
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make a request to the Azure DevOps API and return both data and total count
 * Useful for paginated endpoints where we need the total count
 */
export async function azureDevOpsFetchWithCount(
  pat: string,
  organization: string,
  endpoint: string,
  options: RequestInit = {},
  baseUrl: string = DEFAULT_AZURE_DEVOPS_ORG_URL
): Promise<{ data: unknown; totalCount: number }> {
  const safePat = sanitizeToken(pat);
  if (!safePat) {
    throw new Error('Invalid Azure DevOps PAT');
  }

  const normalizedOrg = normalizeOrganizationReference(organization, baseUrl);
  if (!normalizedOrg) {
    throw new Error('Invalid Azure DevOps organization');
  }

  if (!endpoint.startsWith('/')) {
    throw new Error('Azure DevOps endpoint must be a relative path');
  }

  const url = buildAzureDevOpsEndpointUrl(normalizedOrg, endpoint, baseUrl);

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AZURE_DEVOPS_API_TIMEOUT_MS);

  try {
    const authHeader = `Basic ${Buffer.from(`:${safePat}`).toString('base64')}`;

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: authHeader
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new AzureDevOpsAPIError(
        `Azure DevOps API error: ${response.status} ${response.statusText} - ${errorBody}`,
        response.status
      );
    }

    // Azure DevOps returns data in a 'value' field with 'count'
    const data = await response.json() as { count?: number; value?: unknown };
    const totalCount = data.count ?? 0;

    return { data, totalCount };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AzureDevOpsAPIError(
        `Azure DevOps API timeout after ${AZURE_DEVOPS_API_TIMEOUT_MS / 1000}s: ${url}`,
        0
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get project ID from a project name
 * Azure DevOps API can work with either project names or IDs
 */
export async function getProjectIdFromName(
  pat: string,
  organization: string,
  projectName: string,
  baseUrl: string = DEFAULT_AZURE_DEVOPS_ORG_URL
): Promise<string> {
  const encodedProject = encodeProjectName(projectName);
  const result = await azureDevOpsFetch(
    pat,
    organization,
    `/projects/${encodedProject}`,
    {},
    baseUrl
  ) as { id: string; name: string };
  return result.id;
}

/**
 * Detect Azure DevOps project from git remote URL
 */
export function detectAzureDevOpsProjectFromRemote(projectPath: string): { organization: string; project: string } | null {
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: getIsolatedGitEnv()
    }).trim();

    if (!remoteUrl) return null;

    // Parse the remote URL to extract organization and project
    let organization = '';
    let project = '';

    // SSH format: git@ssh.dev.azure.com:v3/organization/project/repository
    const sshMatch = remoteUrl.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\//);
    if (sshMatch) {
      organization = sshMatch[1];
      project = sshMatch[2];
    }

    // HTTPS format: https://dev.azure.com/organization/project/_git/repository
    const httpsMatch = remoteUrl.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//);
    if (httpsMatch) {
      organization = httpsMatch[1];
      project = httpsMatch[2];
    }

    // On-premises format: https://azureinstance.com/collection/project/_git/repository
    const onPremMatch = remoteUrl.match(/^https?:\/\/[^/]+\/[^/]+\/([^/]+)\/_git\//);
    if (onPremMatch) {
      project = onPremMatch[1];
    }

    if (organization && project) {
      return { organization, project };
    }

    return null;
  } catch {
    return null;
  }
}
