# Secure Local Web Fetch for DeepSeek Harness

A secure, local Readability provider for the native DeepSeek Harness `web_fetch` tool.

It fetches public HTTP(S) pages through `dsh-safe-web-fetch`, extracts useful HTML locally, and lets DSH perform its native Markdown conversion. This is an unofficial community plugin.

## What it does

- Blocks localhost, private networks, metadata endpoints, and reserved IP ranges.
- Revalidates DNS and every redirect.
- Prioritizes URL fragments, then Mozilla Readability, `<main>`/`<article>`, and a sanitized document fallback.
- Preserves titles, bylines, notes, tables, code blocks, citations, and links.
- Removes scripts, forms, dangerous attributes, and `data:` URLs.
- Returns balanced HTML capped at 100,000 characters.
- Uses no browser, cookies, credentials, remote extraction service, or DeepSeek API key.

## Requirements

- DeepSeek Harness with the Web profile
- Node.js 22.22.2 or newer

## Install

```sh
dsh plugin --profile web add "git+https://github.com/Apoze/dsh-web-fetch-local.git#v0.1.0"
```

Add this provider to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: web
  config:
    fetchProvider: local-safe-readability

- insert:
    - id: web-fetch-local
      name: dsh-web-fetch-local
```

Restart DSH, then verify the composed profile:

```sh
dsh --profile web --dump-config
dsh web
```

## Limits

- Maximum URL length: 2,048 characters
- Maximum response: 5 MB
- Maximum redirects: 5
- Provider timeout: 25 seconds
- Maximum returned content: 100,000 characters

Large HTML documents may take longer to parse so useful content is not discarded. PDF, browser-rendered JavaScript, and binary files are intentionally unsupported.

## Test

```sh
pnpm install --frozen-lockfile
pnpm test
```

## License

[MIT](LICENSE)
