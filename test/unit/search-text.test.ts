import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../src/api/client.js";
import { lexwareSearchText } from "../../src/api/search-text.js";
import { readTools } from "../../src/tools/read.js";

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

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const tool = (name: string) => {
  const t = readTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
};

test("encodes only the three characters Lexware stores as HTML entities", () => {
  assert.equal(lexwareSearchText(undefined), undefined);
  assert.equal(lexwareSearchText("Müller GmbH"), "Müller GmbH");
  assert.equal(lexwareSearchText("100%_done\\%"), "100%_done\\%");
  assert.equal(lexwareSearchText("O'Brien"), "O'Brien");
  assert.equal(lexwareSearchText("<& >"), "&lt;&amp; &gt;");
  assert.equal(lexwareSearchText("johnson & partner"), "johnson &amp; partner");
});

test("list_contacts sends an ampersand in name and email as the documented entity", async () => {
  const s = stubFetch([json(200, { content: [] })]);
  const client = createClient({ apiKey: "k", fetch: s.fetch, sleep: async () => {} });
  await tool("list_contacts").run(client, { name: "johnson & partner", email: "a&b@example.com" });
  assert.equal(s.calls[0]?.url, "https://api.lexware.io/v1/contacts?name=johnson+%26amp%3B+partner&email=a%26amp%3Bb%40example.com");
  assert.equal(s.calls.length, 1);
});

test("list_contacts encodes < and > in a name", async () => {
  const s = stubFetch([json(200, { content: [] })]);
  const client = createClient({ apiKey: "k", fetch: s.fetch, sleep: async () => {} });
  await tool("list_contacts").run(client, { name: "A <B>" });
  assert.equal(s.calls[0]?.url, "https://api.lexware.io/v1/contacts?name=A+%26lt%3BB%26gt%3B");
});

test("a contact name without those characters is left unchanged", async () => {
  const s = stubFetch([json(200, { content: [] })]);
  const client = createClient({ apiKey: "k", fetch: s.fetch, sleep: async () => {} });
  await tool("list_contacts").run(client, { name: "Müller GmbH" });
  assert.equal(s.calls[0]?.url, "https://api.lexware.io/v1/contacts?name=M%C3%BCller+GmbH");
});

test("list_vouchers HTML-encodes the voucher number and nothing else", async () => {
  const s = stubFetch([json(200, { content: [] })]);
  const client = createClient({ apiKey: "k", fetch: s.fetch, sleep: async () => {} });
  await tool("list_vouchers").run(client, { voucherType: ["invoice"], voucherStatus: ["open"], voucherNumber: "RE-&-1" });
  assert.equal(s.calls[0]?.url, "https://api.lexware.io/v1/voucherlist?voucherType=invoice&voucherStatus=open&voucherNumber=RE-%26amp%3B-1");
});

test("article filters are not HTML-encoded", async () => {
  const s = stubFetch([json(200, { content: [] })]);
  const client = createClient({ apiKey: "k", fetch: s.fetch, sleep: async () => {} });
  await tool("list_articles").run(client, { articleNumber: "A&B-100", gtin: "400<1>" });
  assert.equal(s.calls[0]?.url, "https://api.lexware.io/v1/articles?articleNumber=A%26B-100&gtin=400%3C1%3E");
});
