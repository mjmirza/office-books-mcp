import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, LexwareApiError, type LexwareClient } from "./api/client.js";
import type { Config } from "./config.js";
import { readTools, type ReadTool } from "./tools/read.js";

const VERSION = "0.0.1";

function asText(value: unknown): string {
  if (value instanceof Uint8Array) return `Binary file, ${value.length} bytes. Downloads are not returned inline.`;
  return JSON.stringify(value, null, 2);
}

function errorText(e: unknown): string {
  if (e instanceof LexwareApiError) return e.details ? `${e.message}\n${asText(e.details)}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

function handler(t: ReadTool, client: LexwareClient) {
  return async (args: Record<string, unknown>) => {
    try {
      const result = await t.run(client, t.input.parse(args));
      return { content: [{ type: "text" as const, text: asText(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: errorText(e) }] };
    }
  };
}

export function buildServer(client: LexwareClient): McpServer {
  const server = new McpServer({ name: "office-books-mcp", version: VERSION });
  for (const t of readTools) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input.shape, annotations: t.annotations }, handler(t, client));
  }
  return server;
}

export async function runStdio(config: Config): Promise<void> {
  const server = buildServer(createClient({ apiKey: config.apiKey }));
  await server.connect(new StdioServerTransport());
}
