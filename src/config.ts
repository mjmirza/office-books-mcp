import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Config {
  apiKey: string;
}

const PLACEHOLDER = "paste-your-api-key-here";

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m || !m[1]) continue;
    let v = (m[2] ?? "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function defaultRead(vars: NodeJS.ProcessEnv): string {
  return readFileSync(vars.OFFICE_BOOKS_ENV_FILE ?? resolve(process.cwd(), ".env/.env.local"), "utf8");
}

export function loadConfig(vars: NodeJS.ProcessEnv = process.env, read: (vars: NodeJS.ProcessEnv) => string = defaultRead): Config {
  let key = vars.LEXWARE_API_KEY?.trim();
  if (!key) {
    try {
      key = parseEnvFile(read(vars)).LEXWARE_API_KEY?.trim();
    } catch {
      key = undefined;
    }
  }
  if (!key || key === PLACEHOLDER) {
    throw new Error(
      "LEXWARE_API_KEY is not set. Create a key in Lexware Office under Einstellungen, Public API (XL plan), then set it in your MCP client config or in .env/.env.local.",
    );
  }
  return { apiKey: key };
}
