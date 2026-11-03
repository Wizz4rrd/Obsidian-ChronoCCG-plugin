# ChronoCCG — Obsidian Plugin

Browse cards, build and validate decks, and keep deck, matchup and tournament notes for the [ChronoCCG](https://playchrono.com/) card game, all inside Obsidian.

> Open `tstvault/` in Obsidian and start at **ChronoCCG/Welcome.md** for a guided tour of every feature.

## Features

- **Inline card references.** `` `chrono:Hush Now` `` renders as a coloured card name with a hover preview (tap on mobile).
- **Card image blocks.** Put one card per line in a `chrono-card` block. Add a `full` line for large cards.
- **Deck blocks.** A `chrono-deck` block takes a deck code, a readable list (`D <diver>` / `<count> <card>`) or YAML. Each block shows:
  - legality against the [official rules](https://playchrono.com/rules): 2 Divers (Agents) + 40 cards, max 3 copies, only the Divers' syndicates, no Diver copies in the main deck
  - energy curve, type and syndicate breakdown
  - a grid/list toggle
  - buttons to **copy the deck code**, **export** (markdown table, text list, JSON, deck block) and **edit in the deck builder**
- **Deck builder** (a full tab):
  - card pool with search, syndicate, type and cost filters, plus "only cards playable with my Divers"
  - Diver slots, +/- controls and live validation
  - import a deck code; save back to the note the deck came from, or create a new deck note
- **Card browser** side panel: filter by cost, syndicate, spell speed, rarity, type, keyword and set. Clicking a card lets you insert it, add it to the builder, set it as Diver or view details.
- **Note templates** for decks, matchups and tournament reports (with frontmatter that works with Dataview). You can override them with your own templates.
- **Card data** synced from [runeterra.ar](https://www.runeterra.ar/chrono/home), cached in the vault and auto-refreshed (every 7 days by default). A custom JSON source is also supported.

Deck codes are compatible with the game and runeterra.ar. The encoder output was checked byte-for-byte against runeterra.ar's own deck-code generator.

### Syntax cheat sheet

````markdown
Inline: `chrono:Shattersmith` or `chrono:258`

```chrono-card
Sensory Deprivation Pod
Shattersmith
```

```chrono-deck
AUGVG33NNZ2XGICSMV3GS5TFBNRW63TTORZHKY3UMVSHUAACAEAAFBIBA4GGMAYMAMHAGCADNUBQEAYZAMBQGAQDAMBQEAYCAM
```

```chrono-deck
name: My deck
D Sensory Deprivation Pod
D Shattersmith
3 Librarian's Assistant
2 Hush Now
```

```chrono-deck
name: My deck
divers: [122, 258]
cards:
  - { id: 102, count: 3 }
  - { name: Hush Now, count: 2 }
```
````

### Commands

| Command | What it does |
| --- | --- |
| Open card browser / Open deck builder | Open the views (also available as ribbon icons) |
| Start a new deck in the builder | Clear the builder |
| Edit deck block in builder | With the cursor inside a `chrono-deck` block |
| Import deck from code… | Open the code in the builder, insert it in a note, or create a deck note |
| Insert inline card reference… / Insert card image block… | Fuzzy card picker |
| Look up a card… / Add card to deck builder… | Fuzzy card picker |
| New deck note / New matchup note / New tournament report | Create a note from a template |
| Write default templates to the template folder | Editable copies of the built-in templates |
| Refresh card database | Re-download card data |

### Templates

Notes go to `ChronoCCG/Decks`, `ChronoCCG/Matchups` and `ChronoCCG/Tournaments`. You can change the root folder in settings. To customise a template, run **Write default templates…** and edit the files it creates. Available placeholders: `{{name}} {{date}} {{deck}} {{code}} {{divers}} {{syndicates}} {{deckLink}} {{opponent}} {{event}}`.

### Known limitations

- runeterra.ar does not publish card rules text, so text search only covers name, type, keywords, syndicate, stats and set. The rules text is printed on the in-game card image shown in previews.
- In Live Preview, inline `chrono:` references keep their code styling. The hover preview still works, and Reading view shows the coloured name.

## Repository layout

```
.
├── manifest.json / versions.json   # Root copies read by Obsidian's community catalog
├── plugin/                          # The Obsidian plugin (TypeScript source, build config)
│   ├── main.ts
│   ├── src/
│   │   ├── data/       types, CardRepository, DataSync, DeckCodec, DeckParser, DeckRules, DeckExport
│   │   ├── markdown/   chrono-card / chrono-deck blocks, inline `chrono:` refs
│   │   ├── ui/         CardBrowserView, DeckBuilderView, previews, modals
│   │   ├── templates/  note templates
│   │   └── settings/
│   ├── tests/          unit tests (node:test) for codec, parser, rules
│   └── scripts/        test runner, version bump
├── tstvault/           # Test vault (plugin is symlinked in) with demo notes in ChronoCCG/
├── .github/workflows/  # CI + tag-triggered release
├── Dockerfile / docker-compose.yml / Makefile
```

## Development (Docker, no host Node required)

All commands run in a `node:20-alpine` container with `./plugin` bind-mounted, so generated files appear directly under `plugin/`.

```bash
make install     # npm install into ./plugin/node_modules (builds the image the first time)
make dev         # watch + rebuild on every save (Ctrl-C to stop)
make build       # production build (typecheck + minify)
make test        # unit tests
make link        # symlink plugin/ into tstvault/.obsidian/plugins/chronoccg
make shell       # shell inside the container
make help        # list all targets
```

After `make link`, enable **ChronoCCG** in Settings → Community plugins inside the test vault, and reload after each rebuild (or install the *Hot Reload* plugin).

## Releasing

1. `cd plugin && npm version patch` (or `minor` / `major`). This syncs `plugin/manifest.json`, the root `manifest.json` and `versions.json`.
2. Push the tag (for example `1.0.1`, with no `v` prefix). The **Release** workflow builds, tests and creates a draft GitHub release with `main.js`, `manifest.json` and `styles.css`.
3. To publish, submit the repo to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) (first release only).

## Credits

- [Chrono CCG](https://playchrono.com/), the game
- [Runeterra.ar](https://www.runeterra.ar/chrono/home) and [Chrono-DB](https://chrono-db.net/), community card data and images

This is an unofficial fan project, not affiliated with the makers of ChronoCCG.

## License

MIT, see [LICENSE](LICENSE).
