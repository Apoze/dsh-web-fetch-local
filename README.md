# dsh-web-fetch-local

Provider `web_fetch` local pour DeepSeek Harness.

- Le transport public HTTP(S), l’anti-SSRF, les limites et les redirections sont délégués à `dsh-safe-web-fetch`.
- L’HTML est réduit au contenu principal avec une ancre ciblée, Mozilla Readability, puis `<main>`/`<article>` en repli, avant nettoyage DOMPurify.
- Une ancre d’URL cible prioritairement sa section; les liens HTTP(S), notes, tableaux, citations et blocs de code restent exploitables.
- Les scripts, formulaires, URI `data:` et attributs dangereux sont supprimés.
- La sortie HTML est tronquée avec un DOM équilibré à 100 000 caractères au maximum.
- DeepSeek Harness conserve sa conversion HTML vers Markdown.
- Aucun navigateur, cookie, credential, PDF ou service distant n’est utilisé.

Le transport est épinglé à `dsh-safe-web-fetch@0.1.0-next.0`. Readability a été conservé après comparaison avec Defuddle `0.19.3`; Defuddle n’est pas une dépendance de production.

```sh
pnpm install --frozen-lockfile
pnpm test
```
