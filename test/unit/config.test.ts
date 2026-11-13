import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, parseEnvFile } from "../../src/config.js";

test("prefers the environment variable", () => {
  const c = loadConfig({ LEXWARE_API_KEY: "from-env" }, () => "LEXWARE_API_KEY=from-file");
  assert.equal(c.apiKey, "from-env");
});

test("falls back to the env file", () => {
  const c = loadConfig({}, () => "# comment\nLEXWARE_API_KEY=\"from-file\"\n");
  assert.equal(c.apiKey, "from-file");
});

test("a missing file and variable gives a helpful error", () => {
  assert.throws(
    () =>
      loadConfig({}, () => {
        throw Object.assign(new Error("nope"), { code: "ENOENT" });
      }),
    /LEXWARE_API_KEY is not set/,
  );
});

test("ignores the placeholder from the example file", () => {
  assert.throws(() => loadConfig({ LEXWARE_API_KEY: "paste-your-api-key-here" }, () => ""), /LEXWARE_API_KEY is not set/);
});

test("parseEnvFile handles quotes, comments, CRLF and blanks", () => {
  const v = parseEnvFile("A=1\r\n# x\n\nB='two'\nC=\"three\"\nBAD LINE\n");
  assert.deepEqual(v, { A: "1", B: "two", C: "three" });
});
