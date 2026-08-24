# dsh-web-fetch-local

Provider `web_fetch` local pour DeepSeek Harness.

- Le transport public HTTP(S), l’anti-SSRF, les limites et les redirections sont délégués à `dsh-safe-web-fetch`.
- L’HTML est réduit au contenu principal avec `<main>` ou Mozilla Readability, puis nettoyé par DOMPurify.
- DeepSeek Harness conserve sa conversion HTML vers Markdown.
- Aucun navigateur, cookie, credential, PDF ou service distant n’est utilisé.

```sh
pnpm install --frozen-lockfile
pnpm test
```
