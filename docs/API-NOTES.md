# Lexware API notes

Checked against https://developers.lexware.io/docs/ on 2026-11-13. Re-check before every release.

## What this server follows

| Topic | Current API | Avoided |
|---|---|---|
| Host | `https://api.lexware.io` | `api.lexoffice.io`, kept only until Dec 2025 |
| Voucher search | `GET /v1/voucherlist` | Filtering on `/v1/vouchers`, deprecated |
| Sales document PDFs (phase 2) | `GET /v1/{type}/{id}/file` subresource, added 2025-08-13 | `/document` render endpoints and `files.documentFileId`, both deprecated |
| Generic file download (phase 2) | `/v1/files/{id}` for bookkeeping vouchers only | Using it for sales voucher documents, deprecated |
| Voucher status | Includes `unchecked` (2024-08-01). Updating an unchecked voucher may only move it to `open` (2026-07-14) | |
| Date filters | `createdDateTo` and `updatedDateTo` are inclusive since 2026-08-11 | |
| Small business revenue category | `f5c7fee8-f184-4e7a-ab04-8f7e7ad6c207` since 2026-04-28. Read categories from `get_reference_data`, never hardcode | Old id `7a1efa0e-6283-4cbf-9583-8e88d3ba5960` |

## Limits found live

| Endpoint | Limit | Evidence |
|---|---|---|
| All | 2 requests per second, HTTP 429 when exceeded | Lexware docs |
| `GET /v1/articles` | `size` must be 25 to 250 | HTTP 406 `"violation":"MIN","field":"size"` on 2026-11-13 |
| `GET /v1/contacts` | `size` 5 accepted | Live sweep 2026-11-13 |

## Package versions

All dependencies matched the latest stable npm release on 2026-11-13 (`npm outdated` empty). MCP tools use the current `registerTool` API of `@modelcontextprotocol/sdk` 1.32.2.
