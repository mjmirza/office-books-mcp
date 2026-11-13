import { z } from "zod";
import type { LexwareClient } from "../api/client.js";

export interface ReadTool {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  annotations: { readOnlyHint: true; openWorldHint: true };
  run(client: LexwareClient, args: Record<string, unknown>): Promise<unknown>;
}

// Lexware ids are 8-4-4-4-12 hex but not always RFC 9562 compliant, so z.guid() not z.uuid().
const uuid = z.guid().describe("Lexware resource id (UUID)");
const page = z.number().int().min(0).optional().describe("0-based page index");
const size = z.number().int().min(1).max(250).optional().describe("Page size, 1 to 250, Lexware default 25");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-MM-dd");

const RO = { readOnlyHint: true, openWorldHint: true } as const;

const SALES_DOCS = {
  invoice: "invoices",
  credit_note: "credit-notes",
  quotation: "quotations",
  order_confirmation: "order-confirmations",
  delivery_note: "delivery-notes",
  down_payment_invoice: "down-payment-invoices",
  dunning: "dunnings",
} as const;

const REFERENCE = {
  countries: "countries",
  payment_conditions: "payment-conditions",
  posting_categories: "posting-categories",
  print_layouts: "print-layouts",
} as const;

const VOUCHER_TYPES = [
  "any",
  "salesinvoice",
  "salescreditnote",
  "purchaseinvoice",
  "purchasecreditnote",
  "invoice",
  "creditnote",
  "orderconfirmation",
  "quotation",
  "downpaymentinvoice",
  "deliverynote",
] as const;

const VOUCHER_STATUS = ["any", "draft", "open", "overdue", "paid", "paidoff", "voided", "transferred", "sepadebit", "accepted", "rejected", "unchecked"] as const;

function def<S extends z.ZodRawShape>(t: {
  name: string;
  title: string;
  description: string;
  input: S;
  run: (client: LexwareClient, args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}): ReadTool {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    input: z.object(t.input) as unknown as z.ZodObject<z.ZodRawShape>,
    annotations: RO,
    run: (client, args) => t.run(client, args as z.infer<z.ZodObject<S>>),
  };
}

export const readTools: ReadTool[] = [
  def({
    name: "get_profile",
    title: "Company profile",
    description: "Read the connected Lexware Office company profile: company name, tax type, small business status and connected user.",
    input: {},
    run: (c) => c.request("GET", "/v1/profile"),
  }),
  def({
    name: "list_contacts",
    title: "List contacts",
    description: "List customers and vendors. Filter by name (min 3 chars), email, customer or vendor number, or role.",
    input: {
      page,
      size,
      name: z.string().min(3).optional(),
      email: z.string().min(3).optional(),
      number: z.number().int().optional().describe("Customer or vendor number"),
      customer: z.boolean().optional(),
      vendor: z.boolean().optional(),
    },
    run: (c, a) =>
      c.request("GET", "/v1/contacts", {
        query: { page: a.page, size: a.size, name: a.name, email: a.email, number: a.number, customer: a.customer, vendor: a.vendor },
      }),
  }),
  def({
    name: "get_contact",
    title: "Get contact",
    description: "Read one contact with addresses, email addresses and phone numbers.",
    input: { id: uuid },
    run: (c, a) => c.request("GET", `/v1/contacts/${a.id}`),
  }),
  def({
    name: "list_articles",
    title: "List articles",
    description: "List products and services from the article catalogue.",
    input: {
      page,
      // Lexware rejects article page sizes below 25 with HTTP 406 (verified live 2026-11-13).
      size: z.number().int().min(25).max(250).optional().describe("Page size, 25 to 250, Lexware default 25"),
      articleNumber: z.string().optional(),
      gtin: z.string().optional(),
      type: z.enum(["PRODUCT", "SERVICE"]).optional(),
    },
    run: (c, a) => c.request("GET", "/v1/articles", { query: { page: a.page, size: a.size, articleNumber: a.articleNumber, gtin: a.gtin, type: a.type } }),
  }),
  def({
    name: "get_article",
    title: "Get article",
    description: "Read one article with its price.",
    input: { id: uuid },
    run: (c, a) => c.request("GET", `/v1/articles/${a.id}`),
  }),
  def({
    name: "list_vouchers",
    title: "Search vouchers",
    description:
      "Search all vouchers (sales and purchase invoices, credit notes, quotations and more) by type, status and dates. Returns metadata. Use get_sales_document or get_voucher for full details.",
    input: {
      voucherType: z.array(z.enum(VOUCHER_TYPES)).min(1),
      voucherStatus: z.array(z.enum(VOUCHER_STATUS)).min(1).describe("'overdue' cannot be combined with other status values"),
      archived: z.boolean().optional(),
      contactId: uuid.optional(),
      voucherDateFrom: day.optional(),
      voucherDateTo: day.optional(),
      voucherNumber: z.string().optional(),
      page,
      size,
    },
    run: (c, a) => {
      if (a.voucherStatus.includes("overdue") && a.voucherStatus.length > 1) {
        throw new Error("Lexware does not allow 'overdue' combined with other status values.");
      }
      return c.request("GET", "/v1/voucherlist", {
        query: {
          voucherType: a.voucherType.join(","),
          voucherStatus: a.voucherStatus.join(","),
          archived: a.archived,
          contactId: a.contactId,
          voucherDateFrom: a.voucherDateFrom,
          voucherDateTo: a.voucherDateTo,
          voucherNumber: a.voucherNumber,
          page: a.page,
          size: a.size,
        },
      });
    },
  }),
  def({
    name: "get_voucher",
    title: "Get bookkeeping voucher",
    description: "Read a bookkeeping voucher (salesinvoice, salescreditnote, purchaseinvoice, purchasecreditnote) with its items and booking categories.",
    input: { id: uuid },
    run: (c, a) => c.request("GET", `/v1/vouchers/${a.id}`),
  }),
  def({
    name: "get_sales_document",
    title: "Get sales document",
    description: "Read an invoice, credit note, quotation, order confirmation, delivery note, down payment invoice or dunning by id.",
    input: { type: z.enum(Object.keys(SALES_DOCS) as [keyof typeof SALES_DOCS, ...Array<keyof typeof SALES_DOCS>]), id: uuid },
    run: (c, a) => c.request("GET", `/v1/${SALES_DOCS[a.type]}/${a.id}`),
  }),
  def({
    name: "get_payments",
    title: "Get payments",
    description: "Read the payment status and payment items of a voucher or sales document.",
    input: { id: uuid.describe("Id of the voucher or sales document") },
    run: (c, a) => c.request("GET", `/v1/payments/${a.id}`),
  }),
  def({
    name: "list_recurring_templates",
    title: "List recurring invoice templates",
    description: "List templates for recurring invoices.",
    input: { page, size },
    run: (c, a) => c.request("GET", "/v1/recurring-templates", { query: { page: a.page, size: a.size } }),
  }),
  def({
    name: "get_reference_data",
    title: "Reference data",
    description: "Read reference lists needed to fill documents correctly: countries with tax classification, payment conditions, posting categories, print layouts.",
    input: { kind: z.enum(Object.keys(REFERENCE) as [keyof typeof REFERENCE, ...Array<keyof typeof REFERENCE>]) },
    run: (c, a) => c.request("GET", `/v1/${REFERENCE[a.kind]}`),
  }),
];
