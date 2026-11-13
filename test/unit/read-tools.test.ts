import { test } from "node:test";
import assert from "node:assert/strict";
import { readTools } from "../../src/tools/read.js";
import type { LexwareClient, Method, RequestOptions } from "../../src/api/client.js";

function recorder() {
  const calls: Array<{ method: Method; path: string; opts?: RequestOptions }> = [];
  const client: LexwareClient = {
    request: async (method, path, opts) => {
      calls.push({ method, path, opts });
      return { ok: true };
    },
  };
  return { client, calls };
}

const tool = (name: string) => {
  const t = readTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
};

const ID = "66196c43-bfee-baf3-4335-d610367059db";

test("every read tool is GET only and annotated read-only", () => {
  assert.ok(readTools.length >= 10);
  for (const t of readTools) assert.equal(t.annotations.readOnlyHint, true, t.name);
});

test("tool names are unique and snake_case", () => {
  const names = readTools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-z][a-z0-9_]*$/);
});

test("get_contact builds the path from a UUID", async () => {
  const r = recorder();
  await tool("get_contact").run(r.client, { id: ID });
  assert.deepEqual(r.calls[0], { method: "GET", path: `/v1/contacts/${ID}`, opts: undefined });
});

test("id inputs reject anything that is not a UUID", () => {
  const schema = tool("get_contact").input;
  assert.equal(schema.safeParse({ id: "../profile" }).success, false);
  assert.equal(schema.safeParse({ id: ID }).success, true);
});

test("list_contacts passes filters as query parameters", async () => {
  const r = recorder();
  await tool("list_contacts").run(r.client, { page: 1, size: 50, name: "Muster", customer: true });
  assert.equal(r.calls[0]?.path, "/v1/contacts");
  assert.deepEqual(r.calls[0]?.opts?.query, { page: 1, size: 50, name: "Muster", email: undefined, number: undefined, customer: true, vendor: undefined });
});

test("list_contacts rejects a page size above Lexware's maximum", () => {
  assert.equal(tool("list_contacts").input.safeParse({ size: 500 }).success, false);
});

test("get_sales_document maps each type to its endpoint", async () => {
  const r = recorder();
  for (const type of ["invoice", "credit_note", "quotation", "dunning"] as const) {
    await tool("get_sales_document").run(r.client, { type, id: ID });
  }
  assert.deepEqual(
    r.calls.map((c) => c.path),
    [`/v1/invoices/${ID}`, `/v1/credit-notes/${ID}`, `/v1/quotations/${ID}`, `/v1/dunnings/${ID}`],
  );
});

test("list_vouchers requires type and status and joins lists with commas", async () => {
  const r = recorder();
  const input = tool("list_vouchers").input;
  assert.equal(input.safeParse({}).success, false);
  await tool("list_vouchers").run(r.client, { voucherType: ["invoice", "creditnote"], voucherStatus: ["open"] });
  assert.equal(r.calls[0]?.path, "/v1/voucherlist");
  assert.equal(r.calls[0]?.opts?.query?.voucherType, "invoice,creditnote");
  assert.equal(r.calls[0]?.opts?.query?.voucherStatus, "open");
});

test("get_reference_data only reaches the four reference endpoints", async () => {
  const r = recorder();
  await tool("get_reference_data").run(r.client, { kind: "posting_categories" });
  assert.equal(r.calls[0]?.path, "/v1/posting-categories");
  assert.equal(tool("get_reference_data").input.safeParse({ kind: "profile" }).success, false);
});
