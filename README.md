# ChronoCCG for Obsidian

An Obsidian plugin for [ChronoCCG](https://playchrono.com/). I wanted to keep my decks, matchup notes and tournament reports in my vault, with real cards in them instead of plain text, so I made this.

If you cloned the repo, you can try it in the example vault: open `example-vault/` in Obsidian and start with `ChronoCCG/Welcome.md`.

## What it does

- Inline card references: write `` `chrono:Hush Now` `` and you get the card name in its syndicate colour, with a preview on hover. Click it to open the card. Works in Reading view and Live Preview. For Agents that immortalize, the preview and the card window show both sides.
- Card images: put card names in a `chrono-card` block, one per line. Add a line with `full` if you want them big.
- Decks: a `chrono-deck` block takes a deck code, a simple list or YAML (examples below). It checks the deck against the [rules](https://playchrono.com/rules) (2 Divers, 40 cards, max 3 copies, only your Divers' syndicates), shows the energy curve and the type/syndicate split, and has buttons to copy the code, export the deck or open it in the builder.
- Deck builder: opens in its own tab. Filter the card pool (you can show only the cards your Divers can play), add/remove cards, and save the deck back to the note it came from or to a new note. Saving a deck note also updates its properties and adds what changed to its "Changelog" section.
- Card browser: a side panel with filters for cost, syndicate, spell speed, rarity, type, keyword and set. Click a card to insert it, add it to the builder or see the details.
- Templates for deck, matchup and tournament notes. The frontmatter works with Dataview. You can replace them with your own.

Deck codes work both ways with the game and with deck sites that use the same format.

If a card can't be found (typo, or a card that isn't in the data yet), it shows up as a grey "?" card instead of disappearing.

### Syntax

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

| Command | |
| --- | --- |
| Open card browser / Open deck builder | Also in the ribbon |
| Start a new deck in the builder | Asks first when the builder has cards in it |
| Save deck in builder | Same as the builder's save button, so you can give it a hotkey |
| Edit deck block in builder | Put the cursor inside a `chrono-deck` block first |
| Copy deck code | Of the `chrono-deck` block under the cursor, or the note's first one |
| Import deck from code… | Open it in the builder, insert it in the note, or make a deck note |
| Insert inline card reference… / Insert card image block… | |
| Look up a card… | |
| New deck note | Also opens the deck builder, linked to the new note |
| New matchup note / New tournament report | |
| Update deck note properties | Sets `deck`, `syndicates`, `divers` and `code` from the note's first deck block |
| Refresh card database | Downloads the card list again |

### Templates

New notes go in `ChronoCCG/Decks`, `ChronoCCG/Matchups` and `ChronoCCG/Tournaments` (you can change the root folder in the settings).

In a deck note (`type: chrono-deck`), the `deck`, `syndicates`, `divers` and `code` properties describe the first `chrono-deck` block. Saving from the deck builder updates them. If you edit the block by hand, the block shows "Note properties are out of date" with an Update button (or run "Update deck note properties"). Properties your template doesn't have are left alone.

Saving a deck note from the deck builder also adds a line to its "Changelog" section, e.g. ``- 2026-11-14 — Diver `chrono:Agent of Stability` → `chrono:Leeflo Mentor`, +2 `chrono:Bloom`, −1 `chrono:Throwdown` ``. Saves on the same day are merged into one line. Notes without a "Changelog" heading are left alone, and you can turn this off in the settings ("Log deck changes"). To edit the templates, click "Write templates" in the settings (Notes → Default templates) and change the files it creates. Placeholders: `{{name}} {{date}} {{deck}} {{code}} {{divers}} {{syndicates}} {{deckLink}} {{opponent}} {{event}}`.

### Deck notes in a base

Deck notes work well in a [base](https://obsidian.md/help/bases) (filter on `type == "chrono-deck"`). The plugin adds a "ChronoCCG decks" view type to bases: a table where the Divers show as inline card references (coloured, with the hover preview; click to open the card) and the syndicates as their icons (saved, so they also show offline). Pick it in the base's view menu. In the view options, "Card properties" sets which properties hold card names (`divers` by default) and "Syndicates property" which one holds syndicates. Columns, sorting, filters and grouping are set like in a normal table.

### Limitations

- Needs Obsidian 1.14.4 or later.
- Mobile (iPad, Android tablets, phones) is not tested yet. The deck builder has a touch layout for tablets, but expect rough edges on mobile, and please report what you find.

## Network use

The plugin only goes online to get the card list, the card images and the six syndicate icons, from the official public data that Chronoverse Games Studio publishes on its CDN and website. It doesn't send anything about you or your vault.

| When | What | Where |
| --- | --- | --- |
| At startup, if the card list is older than the refresh interval (7 days by default) | Downloads the card list (one file per set) | `cdn.playchrono.com` |
| When you run "Refresh card database" | Same | `cdn.playchrono.com` |
| The first time a card image is shown | Downloads the image (about 1.3 MB) | `cdn.playchrono.com` |
| When you click "Download all card images" in the settings | Downloads every card image that isn't saved yet | `cdn.playchrono.com` |
| The first time a syndicate icon is shown | Downloads the icon (about 3 KB) | `playchrono.com` |
| If you set a custom data URL | Downloads the card list | Your URL |

The card list (`card-cache.json`) and the images and icons (`image-cache/`) are saved in the plugin folder, so each image is only downloaded once and everything you've already seen works offline. Saved images are shrunk to 400px wide WebP (about 35 KB each, roughly 14 MB for all 390 deck-legal cards). To have every card offline at once, use "Download all card images" in the settings: it downloads the missing ones (a few at a time, you can cancel) and saves the same 400px copies. You can clear the saved images in the settings, or turn off saving them: that deletes them too (after asking), and the full-size image is then loaded every time. Set the auto-refresh interval to `0` to turn off the automatic download. If you pick the "Bundled" source it never downloads anything (syndicate icons are replaced by plain icons), but you only get a placeholder card.

## Plans

- Tested mobile support (tablets first)
- Matchup stats (win rates per deck and opponent) from your matchup notes

## Development

Everything runs in Docker (`node:20-alpine`), so you don't need Node installed. `./plugin` is mounted in the container, so the build output ends up in `plugin/`.

```bash
make install     # npm install (builds the image the first time)
make dev         # rebuild on save
make build       # production build
make test        # unit tests
make lint        # ESLint with Obsidian's plugin rules
make link        # symlink plugin/ into example-vault/.obsidian/plugins/chronoccg
make shell       # shell in the container
make help        # all targets
```

After `make link`, turn on ChronoCCG in Settings → Community plugins in the example vault. Reload the plugin after each build, or use the Hot Reload plugin.

```
.
├── manifest.json / versions.json   copies for Obsidian's plugin list
├── plugin/
│   ├── main.ts
│   ├── src/
│   │   ├── data/       card data, deck codes, parsing, rules, export
│   │   ├── markdown/   chrono-card / chrono-deck blocks, inline refs
│   │   ├── ui/         card browser, deck builder, previews, modals
│   │   ├── templates/
│   │   └── settings/
│   ├── tests/
│   └── scripts/        test runner, version bump
├── example-vault/      vault for testing, with example notes (not shipped)
├── .github/workflows/  CI and release
└── Dockerfile / docker-compose.yml / Makefile
```

### Releasing

1. `cd plugin && npm version patch` (or `minor` / `major`). This updates both `manifest.json` files and `versions.json`.
2. Push the tag (e.g. `1.0.1`, no `v`). The Release workflow builds, runs the tests and makes a draft GitHub release with `main.js`, `manifest.json` and `styles.css`.
3. First release only: submit the repo to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases).

## Use of AI

I used AI coding tools (Claude Code) while building this plugin, the same way I'd use any other dev tool. I decided what the plugin does and how it works, reviewed the code, and tested it in my own vault. If you find something that looks off, please open an issue.

## Credits

- [ChronoCCG](https://playchrono.com/), the game, and its official public data on `cdn.playchrono.com`, for the card data and images

This is an unofficial fan project. It isn't affiliated with or endorsed by Chronoverse Games Studio, who make ChronoCCG. Card names, images and text belong to them. The MIT license only covers the plugin's code.

## License

MIT, see [LICENSE](LICENSE).
