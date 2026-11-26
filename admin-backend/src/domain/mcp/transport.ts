
export type McpTransport = 'http' | 'stdio';

export const MCP_TRANSPORT_HINT = 'http（streamable-http）或 stdio';

export function normalizeTransport(value: unknown): McpTransport | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'http':
    case 'streamable-http':
    case 'streamable_http':
    case 'streamablehttp':
      return 'http';
    case 'stdio':
      return 'stdio';
    default:
      return null;
  }
}
