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
- Queues excess fetches in cancellable FIFO order instead of exposing the transport's local concurrency refusal.
- Uses no browser, cookies, credentials, remote extraction service, or DeepSeek API key.

## Requirements

- DeepSeek Harness with the Web profile
- Node.js 22.22.2 or newer

## Install

```sh
dsh plugin --profile web add /path/to/built/dsh-web-fetch-local
```

Configure the installed bundle in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: web
  config:
    fetchProvider: local-safe-readability
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
- Concurrent fetches: 8; additional requests wait in FIFO order
- Maximum returned content: 100,000 characters

Large HTML documents may take longer to parse so useful content is not discarded. PDF, browser-rendered JavaScript, and binary files are intentionally unsupported.

## Test

```sh
pnpm install --frozen-lockfile
pnpm test
```

## License

[MIT](LICENSE)

## HTTP transport maintenance

Version 0.1.1 uses the compiled Apoze dsh-safe-web-fetch 0.1.0-next.1 release (source commit 736e690cccd2d74126455633cd92fd252c35de08), pinned with a lockfile integrity hash. Its Undici 8.10.2 fixes the uncaught paused-parser EOF crash described in https://github.com/nodejs/undici/issues/5360. No runtime exception suppression or node_modules patching is used. Existing DNS pinning, private-address rejection, cancellation and size limits remain in force.

## Compatibilité DSH 0.2.0-rc.1

Cette version cible les contrats V4 de DSH et Cordis 4.0.4. L’installation locale utilise le fork natif NInfer basé sur le tag officiel `dsh-v0.2.0-rc.1`. Les anciens plugins de récupération finale ne doivent pas être activés en parallèle avec `dsh-generation-recovery`.

Pour développer contre le fork natif : installer les dépendances, puis exécuter `DSH_NATIVE_ROOT=/chemin/du/fork node scripts/link-native-core.mjs` avant la compilation. Les liens restent locaux dans `node_modules` ; les manifests et fichiers de verrouillage restent portables.

## Gestionnaire de plugins DSH

Le paquet déclare un bundle natif (`dsh.bundle.patch`) : il apparaît dans **Plugins → Installed**, avec activation/désactivation et désinstallation du profil. Installer le dossier construit avec `dsh plugin --profile web add /chemin/du/paquet`. Aucune publication GitHub ou npm n’est nécessaire.

Le bundle est le seul propriétaire de l’entrée `web-fetch-local`. Ne pas conserver une ancienne directive `insert` pour cette même entrée : remplacer celle-ci par un patch `id`/`config`, sans `name`. Les réglages utilisateur restent hors du paquet. Les interrupteurs agissent sur le profil sélectionné ; ne pas désactiver pendant une génération.

Le bundle enregistre le fournisseur sans réécrire les choix de routage `web`. Conserver les autres champs de `web.config` lors d’une modification. Désactiver un fournisseur encore sélectionné rend cette fonction Web indisponible, sans fallback silencieux vers un service différent.

## DSH 0.2.1 compatibility

This version targets DSH `0.2.1-rc.3`; the manifest declares this tested runtime through `engines.dsh`. Earlier plugin versions remain available in Git history for DSH `0.2.0-rc.1`.

The removed DSH runtime-invariant package is no longer a direct dependency. Public-URL validation and download protections remain enabled.
