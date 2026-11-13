#!/usr/bin/env node
import { createClient, LexwareApiError } from "./api/client.js";
import { loadConfig } from "./config.js";
import { runStdio } from "./server.js";

const USAGE = `Usage: office-books-mcp <command>
  doctor   Check the API key against Lexware Office and show the connected company
  serve    Run the MCP server over stdio (default)`;

async function doctor(): Promise<number> {
  const client = createClient({ apiKey: loadConfig().apiKey });
  try {
    const p = (await client.request("GET", "/v1/profile")) as { companyName?: string; organizationId?: string };
    process.stdout.write(`OK. Connected to Lexware Office company "${p.companyName ?? "unknown"}".\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof LexwareApiError ? `${e.message} (HTTP ${e.status})` : String(e);
    process.stderr.write(`FAILED. ${msg}\n`);
    return 1;
  }
}

async function main(cmd: string | undefined): Promise<number> {
  if (cmd === "doctor") return doctor();
  if (!cmd || cmd === "serve") {
    await runStdio(loadConfig());
    return -1;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

main(process.argv[2]).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
