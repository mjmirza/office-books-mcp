// Live read sweep against a real Lexware Office account. Reads only, never writes.
import { createClient, LexwareApiError } from "../src/api/client.js";
import { loadConfig } from "../src/config.js";
import { readTools } from "../src/tools/read.js";

type Page = { content?: Array<{ id?: string }> };

const client = createClient({ apiKey: loadConfig().apiKey });
const tool = (n: string) => readTools.find((t) => t.name === n)!;

const results: Array<{ name: string; ok: boolean; note: string }> = [];

async function check(name: string, args: Record<string, unknown>, label = name): Promise<unknown> {
  try {
    const r = await tool(name).run(client, tool(name).input.parse(args));
    const n = Array.isArray((r as Page)?.content) ? `${(r as Page).content!.length} items` : Array.isArray(r) ? `${(r as unknown[]).length} items` : "object";
    results.push({ name: label, ok: true, note: n });
    return r;
  } catch (e) {
    const note = e instanceof LexwareApiError ? `HTTP ${e.status} ${e.message}` : String(e);
    results.push({ name: label, ok: false, note });
    return undefined;
  }
}

const firstId = (r: unknown): string | undefined => (r as Page)?.content?.[0]?.id;

// Lexware allows 2 requests per second, so checks run one after another on purpose.
const runSequentially = <T>(items: T[], fn: (x: T) => Promise<unknown>) => items.reduce((p, x) => p.then(() => fn(x)), Promise.resolve() as Promise<unknown>);

const main = async () => {
  await check("get_profile", {});
  const contacts = await check("list_contacts", { size: 5 });
  const contactId = firstId(contacts);
  if (contactId) await check("get_contact", { id: contactId });
  else results.push({ name: "get_contact", ok: true, note: "skipped, no contacts in account" });

  const articles = await check("list_articles", { size: 25 });
  const articleId = firstId(articles);
  if (articleId) await check("get_article", { id: articleId });
  else results.push({ name: "get_article", ok: true, note: "skipped, no articles in account" });

  const vouchers = (await check("list_vouchers", { voucherType: ["any"], voucherStatus: ["any"], size: 50 })) as {
    content?: Array<{ id: string; voucherType: string }>;
  };
  const byType = new Map<string, string>();
  (vouchers?.content ?? []).forEach((v) => {
    if (!byType.has(v.voucherType)) byType.set(v.voucherType, v.id);
  });

  const bookkeeping = ["salesinvoice", "salescreditnote", "purchaseinvoice", "purchasecreditnote"].map((t) => byType.get(t)).find(Boolean);
  if (bookkeeping) await check("get_voucher", { id: bookkeeping });
  else results.push({ name: "get_voucher", ok: true, note: "skipped, no bookkeeping voucher in account" });

  const salesMap: Record<string, string> = {
    invoice: "invoice",
    creditnote: "credit_note",
    quotation: "quotation",
    orderconfirmation: "order_confirmation",
    deliverynote: "delivery_note",
    downpaymentinvoice: "down_payment_invoice",
  };
  const salesFound = [...byType].filter(([t]) => salesMap[t]);
  await runSequentially(salesFound, ([t, id]) => check("get_sales_document", { type: salesMap[t], id }, `get_sales_document(${salesMap[t]})`));
  if (salesFound.length === 0) results.push({ name: "get_sales_document", ok: true, note: "skipped, no sales documents in account" });

  const paid = byType.get("invoice") ?? bookkeeping;
  if (paid) await check("get_payments", { id: paid });
  else results.push({ name: "get_payments", ok: true, note: "skipped, no voucher in account" });

  await check("list_recurring_templates", { size: 5 });
  await runSequentially(["countries", "payment_conditions", "posting_categories", "print_layouts"], (kind) =>
    check("get_reference_data", { kind }, `get_reference_data(${kind})`),
  );

  results.forEach((r) => process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(40)} ${r.note}\n`));
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
};

main();
