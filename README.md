# ChronoCCG — Obsidian Plugin

Browse cards, build decks and write notes for the [ChronoCCG](https://playchrono.com/) card game directly inside Obsidian.

> **Status:** early development. Milestone **M1 (foundations)** is in place: settings, card repository, data sync skeleton, bundled seed.

## Features (planned)

- Inline card previews via `chrono-card` and `chrono-deck` codeblocks
- Searchable card browser (filter by syndicate, type, cost, rarity, keyword)
- Deck builder with import/export (deck code, markdown table, JSON)
- Note templates for decks, matchups, tournament reports
- Card data synced from [Runeterra.ar](https://www.runeterra.ar/chrono/home) and [Chrono-DB](https://chrono-db.net/) (with the maintainers' permission)

## Repository layout

```
.
├── plugin/          # The Obsidian plugin (TypeScript source, build config)
│   ├── main.ts
│   ├── manifest.json
│   ├── package.json
│   └── src/
├── tstvault/        # Test Obsidian vault used during development
├── Dockerfile       # Node toolchain (so you don't install Node on your host)
└── docker-compose.yml
```

## Development (Docker, no host Node required)

All build commands run inside a `node:20-alpine` container with `./plugin` bind-mounted, so generated files (`main.js`, `node_modules/`) appear directly on your disk under `plugin/`.

The repo ships with a `Makefile` that wraps the common Docker Compose commands:

```bash
make image       # build the dev image (first time only)
make install     # npm install into ./plugin/node_modules
make dev         # watch + rebuild on every save (Ctrl-C to stop)
make build       # one-shot production build (typecheck + minify)
make shell       # open a shell inside the container
make link        # symlink plugin/ into tstvault/.obsidian/plugins/chronoccg
make unlink      # remove that symlink
make clean       # wipe node_modules + main.js
make help        # list all targets
```

If you'd rather not use `make`, the equivalent raw commands are:

```bash
docker compose build
docker compose run --rm install
docker compose up dev
docker compose run --rm build
```

After `make link`, enable **ChronoCCG** in Settings → Community plugins inside the test vault. Reload after each rebuild (or install the *Hot Reload* community plugin).

### Architecture (inside `plugin/`)

```
main.ts                       Plugin entry (loads settings, repository, sync, commands)
src/data/types.ts             Card, Deck, Syndicate domain types
src/data/CardRepository.ts    In-memory card index + search
src/data/DataSync.ts          Fetch + normalize remote datasets, vault cache
src/data/cards.seed.ts        Tiny offline fallback dataset
src/settings/SettingsTab.ts   User-facing settings panel
src/utils/imageUrl.ts         Resolves card image URLs
```

## Roadmap

- **M1 — Foundations** ✅ scaffold, settings, repository, sync skeleton
- **M2 — Inline rendering** `chrono-card` / `chrono-deck` codeblocks, hover previews
- **M3 — Card browser** filterable side-pane view
- **M4 — Deck builder** drag-and-drop, import/export
- **M5 — Note templates** decks, matchups
- **M6 — Polish & release** mobile, theming, community submission

## Credits

- [Chrono CCG](https://playchrono.com/) — the game
- [Runeterra.ar](https://www.runeterra.ar/chrono/home) and [Chrono-DB](https://chrono-db.net/) — community card data and images
