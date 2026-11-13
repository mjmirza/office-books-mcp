# Environment variables

| Variable | Required | Format | Description |
|---|---|---|---|
| LEXWARE_API_KEY | Yes | opaque string | Lexware Office Public API key, created under Einstellungen, Public API |
| OFFICE_BOOKS_ENV_FILE | No | file path | Alternative env file. Default is `.env/.env.local` in the working directory |

## Setup

1. Copy `.env.example` to `.env.local` in this folder.
2. Paste your key.
3. Never commit `.env.local`.
