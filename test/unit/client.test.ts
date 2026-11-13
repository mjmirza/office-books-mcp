import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, LexwareApiError } from "../../src/api/client.js";

type Call = { url: string; init: RequestInit };

function stubFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const noWait = { sleep: async () => {} };

test("sends the bearer key and parses JSON", async () => {
  const s = stubFetch([json(200, { companyName: "Test GmbH" })]);
  const c = createClient({ apiKey: "k-123", fetch: s.fetch, ...noWait });
  const r = await c.request("GET", "/v1/profile");
  assert.deepEqual(r, { companyName: "Test GmbH" });
  assert.equal(s.calls[0]?.url, "https://api.lexware.io/v1/profile");
  assert.equal((s.calls[0]?.init.headers as Record<string, string>).Authorization, "Bearer k-123");
});

test("adds query parameters and skips undefined ones", async () => {
  const s = stubFetch([json(200, { content: [] })]);
  const c = createClient({ apiKey: "k", fetch: s.fetch, ...noWait });
  await c.request("GET", "/v1/contacts", { query: { page: 2, name: "Müller", email: undefined } });
  assert.equal(s.calls[0]?.url, "https://api.lexware.io/v1/contacts?page=2&name=M%C3%BCller");
});

test("retries a 429 because Lexware did not perform the call", async () => {
  const s = stubFetch([json(429, { message: "Rate limit" }), json(429, {}), json(200, { ok: true })]);
  const c = createClient({ apiKey: "k", fetch: s.fetch, ...noWait });
  assert.deepEqual(await c.request("POST", "/v1/contacts", { body: { a: 1 } }), { ok: true });
  assert.equal(s.calls.length, 3);
});

test("gives up after the retry budget on persistent 429", async () => {
  const s = stubFetch([json(429, {}), json(429, {}), json(429, {}), json(429, {})]);
  const c = createClient({ apiKey: "k", fetch: s.fetch, maxRetries: 3, ...noWait });
  await assert.rejects(c.request("GET", "/v1/profile"), (e: unknown) => e instanceof LexwareApiError && e.status === 429);
  assert.equal(s.calls.length, 4);
});

test("retries a 503 on GET but never on a write", async () => {
  const get = stubFetch([json(503, {}), json(200, { ok: 1 })]);
  const cg = createClient({ apiKey: "k", fetch: get.fetch, ...noWait });
  assert.deepEqual(await cg.request("GET", "/v1/profile"), { ok: 1 });

  const post = stubFetch([json(503, {}), json(200, { ok: 1 })]);
  const cp = createClient({ apiKey: "k", fetch: post.fetch, ...noWait });
  await assert.rejects(cp.request("POST", "/v1/contacts", { body: {} }), (e: unknown) => e instanceof LexwareApiError && e.status === 503);
  assert.equal(post.calls.length, 1);
});

test("a network error on GET is retried, on a write it is not", async () => {
  const get = stubFetch([new TypeError("fetch failed"), json(200, { ok: 1 })]);
  const cg = createClient({ apiKey: "k", fetch: get.fetch, ...noWait });
  assert.deepEqual(await cg.request("GET", "/v1/profile"), { ok: 1 });

  const put = stubFetch([new TypeError("fetch failed")]);
  const cp = createClient({ apiKey: "k", fetch: put.fetch, ...noWait });
  await assert.rejects(cp.request("PUT", "/v1/contacts/x", { body: {} }), /may or may not have been applied/);
});

test("maps a 401 to a clear message without leaking the key", async () => {
  const s = stubFetch([json(401, { message: "Unauthorized" })]);
  const c = createClient({ apiKey: "secret-key-xyz", fetch: s.fetch, ...noWait });
  await assert.rejects(c.request("GET", "/v1/profile"), (e: unknown) => {
    assert.ok(e instanceof LexwareApiError);
    assert.equal(e.status, 401);
    assert.match(e.message, /API key/);
    assert.doesNotMatch(e.message, /secret-key-xyz/);
    return true;
  });
});

test("a timeout surfaces as an error, not a hang", async () => {
  const abort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const s = stubFetch([abort, abort, abort, abort]);
  const c = createClient({ apiKey: "k", fetch: s.fetch, ...noWait });
  await assert.rejects(c.request("GET", "/v1/profile"), /timed out/);
});

test("rejects paths that leave the API", async () => {
  const s = stubFetch([]);
  const c = createClient({ apiKey: "k", fetch: s.fetch, ...noWait });
  await assert.rejects(c.request("GET", "https://evil.example/v1/x"), /must start with \/v1\//);
  await assert.rejects(c.request("GET", "/v1/../admin"), /must start with \/v1\//);
  assert.equal(s.calls.length, 0);
});

test("returns raw bytes for binary file downloads", async () => {
  const s = stubFetch([new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } })]);
  const c = createClient({ apiKey: "k", fetch: s.fetch, ...noWait });
  const r = await c.request("GET", "/v1/invoices/abc/file", { accept: "application/pdf" });
  assert.ok(r instanceof Uint8Array);
  assert.equal(r.length, 4);
});
