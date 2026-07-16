/**
 * Unit tests for Azure DevOps Auth handlers
 * Tests PAT validation, redaction, and organization/project validation
 */
import { describe, it, expect } from 'vitest';

/**
 * Validate that a PAT string is not empty and has reasonable length
 */
function isValidPATFormat(pat: string): boolean {
  if (!pat || typeof pat !== 'string') return false;
  // PATs are typically base64-encoded strings, at least 10 chars
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
 * Redact sensitive information from data before logging
 */
function redactSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    // Redact anything that looks like a PAT (typically base64 or similar)
    if (data.length > 20 && !data.includes(' ') && !data.includes('/')) {
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
      // Redact known sensitive keys
      if (/token|password|secret|credential|pat|auth/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result;
  }
  return data;
}

describe('Azure DevOps Auth Handlers', () => {
  describe('isValidPATFormat', () => {
    it('should accept valid PAT format', () => {
      // Standard PAT format (minimum length 10)
      expect(isValidPATFormat('validpat123')).toBe(true);
      expect(isValidPATFormat('abcdefghij')).toBe(true);
      expect(isValidPATFormat('1234567890')).toBe(true);
    });

    it('should accept long PAT formats', () => {
      // Azure DevOps PATs can be quite long (base64-encoded)
      expect(isValidPATFormat('a'.repeat(100))).toBe(true);
      expect(isValidPATFormat('abcdef'.repeat(50))).toBe(true);
    });

    it('should accept PAT at maximum length', () => {
      // Allow up to 1024 chars as defense-in-depth
      expect(isValidPATFormat('a'.repeat(1024))).toBe(true);
    });

    it('should reject empty or short PAT', () => {
      expect(isValidPATFormat('')).toBe(false);
      expect(isValidPATFormat('123')).toBe(false);
      expect(isValidPATFormat('short')).toBe(false); // Less than 10 chars
      expect(isValidPATFormat('123456789')).toBe(false); // 9 chars
    });

    it('should reject invalid PAT types', () => {
      expect(isValidPATFormat(null as unknown as string)).toBe(false);
      expect(isValidPATFormat(undefined as unknown as string)).toBe(false);
      expect(isValidPATFormat(123 as unknown as string)).toBe(false);
      expect(isValidPATFormat({} as unknown as string)).toBe(false);
      expect(isValidPATFormat([] as unknown as string)).toBe(false);
    });

    it('should reject PAT exceeding maximum length', () => {
      expect(isValidPATFormat('a'.repeat(1025))).toBe(false);
      expect(isValidPATFormat('a'.repeat(2000))).toBe(false);
    });
  });

  describe('isValidOrganization', () => {
    it('should accept valid organization names', () => {
      expect(isValidOrganization('myorg')).toBe(true);
      expect(isValidOrganization('my-org')).toBe(true);
      expect(isValidOrganization('my_org')).toBe(true);
      expect(isValidOrganization('MyOrg123')).toBe(true);
    });

    it('should accept organization URLs', () => {
      // URLs are validated by buildAzureDevOpsApiBaseUrl, so we just check length
      expect(isValidOrganization('https://dev.azure.com/myorg')).toBe(true);
      expect(isValidOrganization('dev.azure.com/myorg')).toBe(true);
    });

    it('should handle whitespace by trimming', () => {
      expect(isValidOrganization('  myorg  ')).toBe(true);
      expect(isValidOrganization('\tmyorg\n')).toBe(true);
    });

    it('should accept organization at maximum length', () => {
      expect(isValidOrganization('a'.repeat(256))).toBe(true);
    });

    it('should reject empty or invalid organizations', () => {
      expect(isValidOrganization('')).toBe(false);
      expect(isValidOrganization('   ')).toBe(false); // Whitespace only
      expect(isValidOrganization('\t\n')).toBe(false);
    });

    it('should reject invalid types', () => {
      expect(isValidOrganization(null as unknown as string)).toBe(false);
      expect(isValidOrganization(undefined as unknown as string)).toBe(false);
      expect(isValidOrganization(123 as unknown as string)).toBe(false);
      expect(isValidOrganization({} as unknown as string)).toBe(false);
    });

    it('should reject organization exceeding maximum length', () => {
      expect(isValidOrganization('a'.repeat(257))).toBe(false);
      expect(isValidOrganization('a'.repeat(1000))).toBe(false);
    });
  });

  describe('isValidProject', () => {
    it('should accept valid project names', () => {
      expect(isValidProject('myproject')).toBe(true);
      expect(isValidProject('my-project')).toBe(true);
      expect(isValidProject('my_project')).toBe(true);
      expect(isValidProject('MyProject123')).toBe(true);
      expect(isValidProject('Project')).toBe(true);
    });

    it('should accept project at maximum length', () => {
      expect(isValidProject('a'.repeat(256))).toBe(true);
    });

    it('should handle whitespace by trimming', () => {
      expect(isValidProject('  myproject  ')).toBe(true);
      expect(isValidProject('\tmyproject\n')).toBe(true);
    });

    it('should reject empty or invalid projects', () => {
      expect(isValidProject('')).toBe(false);
      expect(isValidProject('   ')).toBe(false); // Whitespace only
      expect(isValidProject('\t\n')).toBe(false);
    });

    it('should reject invalid types', () => {
      expect(isValidProject(null as unknown as string)).toBe(false);
      expect(isValidProject(undefined as unknown as string)).toBe(false);
      expect(isValidProject(123 as unknown as string)).toBe(false);
      expect(isValidProject({} as unknown as string)).toBe(false);
    });

    it('should reject project exceeding maximum length', () => {
      expect(isValidProject('a'.repeat(257))).toBe(false);
      expect(isValidProject('a'.repeat(1000))).toBe(false);
    });
  });

  describe('redactSensitiveData', () => {
    it('should redact long token-like strings in data', () => {
      const data = 'Token is abcdefghijklmnopqrst123456789';
      const result = redactSensitiveData(data);
      expect(result).toBe('[REDACTED_PAT]');
    });

    it('should preserve short strings', () => {
      expect(redactSensitiveData('short')).toBe('short');
      expect(redactSensitiveData('normal text here')).toBe('normal text here');
    });

    it('should redact sensitive keys in objects', () => {
      const data = {
        username: 'testuser',
        pat: 'secrettoken123456',
        token: 'abcdefghijklmnopqrst',
        password: 'mypassword',
        auth: 'bearer xyz',
        credential: 'cred789',
        organization: 'myorg'
      };

      const result = redactSensitiveData(data) as Record<string, unknown>;

      expect(result.username).toBe('testuser');
      expect(result.pat).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.auth).toBe('[REDACTED]');
      expect(result.credential).toBe('[REDACTED]');
      expect(result.organization).toBe('myorg');
    });

    it('should redact nested sensitive data', () => {
      const data = {
        config: {
          pat: 'secrettoken123456',
          organization: 'myorg'
        },
        credentials: {
          token: 'abcdefghijklmnopqrst',
          username: 'user'
        }
      };

      const result = redactSensitiveData(data) as Record<string, Record<string, unknown>>;

      expect(result.config.pat).toBe('[REDACTED]');
      expect(result.config.organization).toBe('myorg');
      expect(result.credentials.token).toBe('[REDACTED]');
      expect(result.credentials.username).toBe('user');
    });

    it('should redact tokens in arrays', () => {
      const data = ['secrettoken123456', 'normal text'];
      const result = redactSensitiveData(data) as unknown[];

      expect(result[0]).toBe('[REDACTED_PAT]');
      expect(result[1]).toBe('normal text');
    });

    it('should handle case-insensitive sensitive keys', () => {
      const data = {
        Token: 'secret123',
        PASSWORD: 'pass456',
        Secret: 'sec789',
        Credential: 'cred000',
        AuthSecret: 'auth111'
      };

      const result = redactSensitiveData(data) as Record<string, unknown>;

      expect(result.Token).toBe('[REDACTED]');
      expect(result.PASSWORD).toBe('[REDACTED]');
      expect(result.Secret).toBe('[REDACTED]');
      expect(result.Credential).toBe('[REDACTED]');
      expect(result.AuthSecret).toBe('[REDACTED]');
    });

    it('should preserve non-sensitive values', () => {
      expect(redactSensitiveData(123)).toBe(123);
      expect(redactSensitiveData(true)).toBe(true);
      expect(redactSensitiveData(false)).toBe(false);
      expect(redactSensitiveData(null)).toBe(null);
      expect(redactSensitiveData(undefined)).toBe(undefined);
    });

    it('should handle complex nested structures', () => {
      const data = {
        items: [
          { id: 1, token: 'secrettoken123456' },
          { id: 2, token: 'secrettoken789012' }
        ],
        config: {
          pat: 'maintoken123456789',
          projects: ['proj1', 'proj2']
        }
      };

      const result = redactSensitiveData(data) as any;

      expect(result.items[0].id).toBe(1);
      expect(result.items[0].token).toBe('[REDACTED]');
      expect(result.items[1].token).toBe('[REDACTED]');
      expect(result.config.pat).toBe('[REDACTED]');
      expect(result.config.projects).toEqual(['proj1', 'proj2']);
    });

    it('should redact URLs with credentials', () => {
      const data = 'https://user:pass@dev.azure.com/secret/token/long/string/here';
      const result = redactSensitiveData(data);
      // The long string should be redacted as a PAT-like token
      expect(result).toBe('[REDACTED_PAT]');
    });
  });
});
