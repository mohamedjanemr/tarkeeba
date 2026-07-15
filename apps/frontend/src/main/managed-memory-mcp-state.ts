let managedMemoryMcpBaseUrl: string | null = null;

export function setManagedMemoryMcpBaseUrl(baseUrl: string | null): void {
  managedMemoryMcpBaseUrl = baseUrl;
}

export function getManagedMemoryMcpProjectUrl(projectId: string): string | null {
  if (!managedMemoryMcpBaseUrl) return null;
  return `${managedMemoryMcpBaseUrl}/mcp/${encodeURIComponent(projectId)}`;
}
