import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClient } from "../../src/api/client.js";
import { TokenBucket } from "../../src/api/rate-limit.js";
import { buildServer } from "../../src/server.js";

const ID = "66196c43-bfee-baf3-4335-d610367059db";
const KEY = "unit-test-key";

type Call = { url: string; init: RequestInit };

function stubFetch(responses?: Array<Response>) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (!responses) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    return next;
  };
  return { fetch, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function clientFor(fetchImpl: typeof globalThis.fetch) {
  return createClient({
    apiKey: KEY,
    fetch: fetchImpl,
    sleep: async () => {},
    bucket: new TokenBucket({ capacity: 1000, refillPerSecond: 1000 }),
  });
}

async function withMcp(fetchImpl: typeof globalThis.fetch, fn: (mcp: Client) => Promise<void>) {
  const server = buildServer(clientFor(fetchImpl));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "office-books-test", version: "0" });
  await mcp.connect(clientTransport);
  try {
    await fn(mcp);
  } finally {
    await mcp.close();
    await server.close();
  }
}

function textOf(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  return result.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

test("the server advertises every read tool as read-only", async () => {
  const s = stubFetch();
  await withMcp(s.fetch, async (mcp) => {
    const listed = await mcp.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "get_article",
      "get_contact",
      "get_payments",
      "get_profile",
      "get_reference_data",
      "get_sales_document",
      "get_voucher",
      "list_articles",
      "list_contacts",
      "list_recurring_templates",
      "list_vouchers",
    ]);
    for (const t of listed.tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  });
  assert.equal(s.calls.length, 0);
});

test("every read tool issues one GET to its Lexware path", async () => {
  const s = stubFetch();
  const cases: Array<{ name: string; args: Record<string, unknown>; url: string }> = [
    { name: "get_profile", args: {}, url: "https://api.lexware.io/v1/profile" },
    { name: "get_contact", args: { id: ID }, url: `https://api.lexware.io/v1/contacts/${ID}` },
    { name: "get_article", args: { id: ID }, url: `https://api.lexware.io/v1/articles/${ID}` },
    { name: "get_voucher", args: { id: ID }, url: `https://api.lexware.io/v1/vouchers/${ID}` },
    { name: "get_payments", args: { id: ID }, url: `https://api.lexware.io/v1/payments/${ID}` },
    { name: "list_contacts", args: { page: 1, size: 50, name: "Muster", customer: true }, url: "https://api.lexware.io/v1/contacts?page=1&size=50&name=Muster&customer=true" },
    { name: "list_articles", args: { size: 25, type: "SERVICE" }, url: "https://api.lexware.io/v1/articles?size=25&type=SERVICE" },
    { name: "list_recurring_templates", args: { page: 0, size: 25 }, url: "https://api.lexware.io/v1/recurring-templates?page=0&size=25" },
    {
      name: "list_vouchers",
      args: { voucherType: ["invoice", "creditnote"], voucherStatus: ["open"], voucherDateFrom: "2024-02-29", voucherDateTo: "2026-11-21" },
      url: "https://api.lexware.io/v1/voucherlist?voucherType=invoice%2Ccreditnote&voucherStatus=open&voucherDateFrom=2024-02-29&voucherDateTo=2026-11-21",
    },
    { name: "get_sales_document", args: { type: "invoice", id: ID }, url: `https://api.lexware.io/v1/invoices/${ID}` },
    { name: "get_sales_document", args: { type: "credit_note", id: ID }, url: `https://api.lexware.io/v1/credit-notes/${ID}` },
    { name: "get_sales_document", args: { type: "quotation", id: ID }, url: `https://api.lexware.io/v1/quotations/${ID}` },
    { name: "get_sales_document", args: { type: "order_confirmation", id: ID }, url: `https://api.lexware.io/v1/order-confirmations/${ID}` },
    { name: "get_sales_document", args: { type: "delivery_note", id: ID }, url: `https://api.lexware.io/v1/delivery-notes/${ID}` },
    { name: "get_sales_document", args: { type: "down_payment_invoice", id: ID }, url: `https://api.lexware.io/v1/down-payment-invoices/${ID}` },
    { name: "get_sales_document", args: { type: "dunning", id: ID }, url: `https://api.lexware.io/v1/dunnings/${ID}` },
    { name: "get_reference_data", args: { kind: "countries" }, url: "https://api.lexware.io/v1/countries" },
    { name: "get_reference_data", args: { kind: "payment_conditions" }, url: "https://api.lexware.io/v1/payment-conditions" },
    { name: "get_reference_data", args: { kind: "posting_categories" }, url: "https://api.lexware.io/v1/posting-categories" },
    { name: "get_reference_data", args: { kind: "print_layouts" }, url: "https://api.lexware.io/v1/print-layouts" },
  ];
  await withMcp(s.fetch, async (mcp) => {
    for (const c of cases) {
      const result = await mcp.callTool({ name: c.name, arguments: c.args });
      assert.notEqual(result.isError, true, c.name);
    }
  });
  assert.deepEqual(
    s.calls.map((c) => c.url),
    cases.map((c) => c.url),
  );
  assert.ok(s.calls.every((c) => c.init.method === "GET"));
  assert.equal((s.calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
});

test("rejected read arguments never reach Lexware", async () => {
  const s = stubFetch();
  const rejected: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "get_contact", args: { id: "../profile" } },
    { name: "list_articles", args: { size: 5 } },
    { name: "list_vouchers", args: { voucherType: ["invoice"], voucherStatus: ["overdue", "open"] } },
    { name: "list_vouchers", args: { voucherType: ["invoice"], voucherStatus: ["open"], voucherDateFrom: "2026-02-31" } },
    { name: "list_vouchers", args: { voucherType: ["invoice"], voucherStatus: ["open"], voucherDateFrom: "2023-02-29" } },
    { name: "get_reference_data", args: { kind: "profile" } },
  ];
  await withMcp(s.fetch, async (mcp) => {
    for (const c of rejected) {
      const result = await mcp.callTool({ name: c.name, arguments: c.args });
      assert.equal(result.isError, true, c.name);
      assert.doesNotMatch(textOf(result), new RegExp(KEY));
    }
  });
  assert.equal(s.calls.length, 0);
});

test("a Lexware 406 is returned as rejected data and does not include the key", async () => {
  const s = stubFetch([json(406, { message: "Validation failed", details: [{ field: "size", violation: "MIN" }] })]);
  await withMcp(s.fetch, async (mcp) => {
    const result = await mcp.callTool({ name: "get_profile", arguments: {} });
    assert.equal(result.isError, true);
    const body = textOf(result);
    assert.match(body, /rejected the request data/);
    assert.match(body, /MIN/);
    assert.doesNotMatch(body, /content type/i);
    assert.doesNotMatch(body, new RegExp(KEY));
  });
  assert.equal(s.calls.length, 1);
});

test("a binary response is described, not inlined", async () => {
  const s = stubFetch([new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } })]);
  await withMcp(s.fetch, async (mcp) => {
    const result = await mcp.callTool({ name: "get_profile", arguments: {} });
    assert.notEqual(result.isError, true);
    const body = textOf(result);
    assert.match(body, /Binary file, 4 bytes/);
    assert.doesNotMatch(body, /PDF/);
  });
});
