# ChronoCCG for Obsidian

An Obsidian plugin for [ChronoCCG](https://playchrono.com/). I wanted to keep my decks, matchup notes and tournament reports in my vault, with real cards in them instead of plain text, so I made this.

You can try it with the test vault: open `TstVault/` in Obsidian and start with `ChronoCCG/Welcome.md`.

## What it does

- Inline card references: write `` `chrono:Hush Now` `` and you get the card name in its syndicate colour, with a preview on hover. Click it to open the card. Works in Reading view and Live Preview.
- Card images: put card names in a `chrono-card` block, one per line. Add a line with `full` if you want them big.
- Decks: a `chrono-deck` block takes a deck code, a simple list or YAML (examples below). It checks the deck against the [rules](https://playchrono.com/rules) (2 Divers, 40 cards, max 3 copies, only your Divers' syndicates), shows the energy curve and the type/syndicate split, and has buttons to copy the code, export the deck or open it in the builder.
- Deck builder: opens in its own tab. Filter the card pool (you can show only the cards your Divers can play), add/remove cards, and save the deck back to the note it came from or to a new note.
- Card browser: a side panel with filters for cost, syndicate, spell speed, rarity, type, keyword and set. Click a card to insert it, add it to the builder or see the details.
- Templates for deck, matchup and tournament notes. The frontmatter works with Dataview. You can replace them with your own.

Deck codes work both ways with the game and with runeterra.ar.

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
| Start a new deck in the builder | Clears the builder |
| Edit deck block in builder | Put the cursor inside a `chrono-deck` block first |
| Import deck from code… | Open it in the builder, insert it in the note, or make a deck note |
| Insert inline card reference… / Insert card image block… | |
| Look up a card… / Add card to deck builder… | |
| New deck note / New matchup note / New tournament report | |
| Write default templates to the template folder | Copies the templates so you can edit them |
| Refresh card database | Downloads the card list again |

### Templates

New notes go in `ChronoCCG/Decks`, `ChronoCCG/Matchups` and `ChronoCCG/Tournaments` (you can change the root folder in the settings). To edit the templates, run "Write default templates to the template folder" and change the files it creates. Placeholders: `{{name}} {{date}} {{deck}} {{code}} {{divers}} {{syndicates}} {{deckLink}} {{opponent}} {{event}}`.

### Limitations

- runeterra.ar doesn't have the cards' rules text, so search only looks at name, type, keywords, syndicate, stats and set. You can still read the text on the card image.
- Desktop only for now (see below).

## Network use

The plugin only goes online to get the card list and the card images. It doesn't send anything about you or your vault.

| When | What | Where |
| --- | --- | --- |
| At startup, if the card list is older than the refresh interval (7 days by default) | Downloads the card list | `www.runeterra.ar` |
| When you run "Refresh card database" | Same | `www.runeterra.ar` |
| The first time a card image is shown | Downloads the image | `cdn.runeterra.ar` |
| If you set a custom data URL | Downloads the card list | Your URL |

The card list (`card-cache.json`) and the images (`image-cache/`) are saved in the plugin folder, so each image is only downloaded once and everything you've already seen works offline. You can turn off saving images or clear them in the settings. Set the auto-refresh interval to `0` to turn off the automatic download. If you pick the "Bundled" source it never downloads anything, but you only get a placeholder card.

## Plans

- Mobile support
- Card rules text in search (runeterra.ar doesn't have it)
- Matchup stats (win rates per deck and opponent) from your matchup notes

## Development

Everything runs in Docker (`node:20-alpine`), so you don't need Node installed. `./plugin` is mounted in the container, so the build output ends up in `plugin/`.

```bash
make install     # npm install (builds the image the first time)
make dev         # rebuild on save
make build       # production build
make test        # unit tests
make lint        # ESLint with Obsidian's plugin rules
make link        # symlink plugin/ into TstVault/.obsidian/plugins/chronoccg
make shell       # shell in the container
make help        # all targets
```

After `make link`, turn on ChronoCCG in Settings → Community plugins in the test vault. Reload the plugin after each build, or use the Hot Reload plugin.

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
├── TstVault/           test vault with example notes
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

- [ChronoCCG](https://playchrono.com/), the game
- [runeterra.ar](https://www.runeterra.ar/chrono/home), for the card data and images

This is an unofficial fan project. It isn't affiliated with or endorsed by Chronoverse Games Studio, who make ChronoCCG. Card names, images and text belong to them. The MIT license only covers the plugin's code.

## License

MIT, see [LICENSE](LICENSE).
