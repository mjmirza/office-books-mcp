// Lexware stores &, < and > as HTML entities in contact and voucher search fields.
// The query must send that form. The HTTP client URL-encodes the result afterwards.
// See docs/API-NOTES.md.
export function lexwareSearchText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
