# ChronoVault — demo vault

This folder shows everything the plugin can do. Open it in **Reading view** for the full rendering; most things also render in Live Preview.

> [!tip] First run
> Run **ChronoVault: Refresh card database** from the command palette (`Cmd/Ctrl+P`) if the cards below show as unknown. The plugin also refreshes on its own every 7 days.

## 1. Inline card references
Write a card name in inline code prefixed with `chrono:` to get a coloured, hoverable reference:

- Silence's finisher: `chrono:Hush Now`
- A strong Diver: `chrono:Shattersmith`
- By id works too: `chrono:102`
- Unknown names are underlined: `chrono:Not A Real Card`

Command: **Insert inline card reference…** opens a fuzzy card picker.

## 2. Card image blocks
One card per line, by name or id. Add a `full` line for big cards.

```chrono-card
Sensory Deprivation Pod
Shattersmith
Librarian's Assistant
```

```chrono-card
Hush Now
full
```

## 3. Decks
A `chrono-deck` block accepts three formats. Each block shows legality (2 Divers + 40 cards, max 3 copies, only the Divers' syndicates), the energy curve, and buttons to **copy the deck code**, **export** (markdown table, text, JSON) and **edit in the deck builder**.

**a) A bare deck code** (from the game or a deck site):

```chrono-deck
AUGVG33NNZ2XGICSMV3GS5TFBNRW63TTORZHKY3UMVSHUAACAEAAFBIBA4GGMAYMAMHAGCADNUBQEAYZAMBQGAQDAMBQEAYCAM
```

**b) A readable list** — `D` marks a Diver, other lines are `<count> <name or id>`. This one is deliberately unfinished, so it shows validation errors:

```chrono-deck
name: Silence brew (WIP)
D Sensory Deprivation Pod
D Shattersmith
3 Librarian's Assistant
3 Hush Now
4 Rotting Rocker
2 Kinetic Absorber
```

**c) YAML** — what the deck builder writes. See [[Somnus Revive]].

## 4. Deck builder
Click the **swords** ribbon icon, or run **Open deck builder**.
- Click a card to add it, right-click to remove one, **Diver** sets it as a Diver.
- "Only cards playable with my Divers" filters the pool to the Divers' syndicates.
- **Save** writes back to the note the deck came from, or creates a new deck note under `ChronoCCG/Decks`.
- **Import deck code**, **Copy deck code** and **Export** are in the header.
- You can go past 40 cards or 3 copies while building (the deck shows as not legal). Saving a deck like that asks first.

## 5. Card browser
The **layers** ribbon icon opens a searchable side panel with filters (cost, syndicate, spell speed, rarity, type, keyword, set). Click a card to insert it, add it to the builder, or see details.

## 6. Note templates
- **New deck note** → `ChronoCCG/Decks`
- **New tournament report** → `ChronoCCG/Tournaments` (copies the decklist from the active note) — see [[2026-11-02 Weekly Dive]]
- **Write default templates to the template folder** gives you editable copies of the templates.

## 7. Match tracker
Click the **trophy** ribbon icon, or run **Open match tracker**.
- **Log a game**: pick your deck and the opponent's syndicates (up to two), optionally the archetype, then press **Win** or **Loss**. The opponent is remembered for the next game.
- Under **Date, patch, opponent's deck, note**: the patch is filled in with the last one you logged. Paste the opponent's deck code to set their syndicates from the Divers, and open it later in the deck builder from the game list (no note is created).
- **Filters** at the top: period, patch, deck, and **Vs**: pick one syndicate for every game against it, or two for that pair.
- With all decks: your decks, a **Matchups** grid (your decks × the six syndicates), and your record against each syndicate and each syndicate pair. Click a deck, a row or a cell to narrow down.
- Pick a deck (or click it) for its own page. The **Win rate per week** chart shows how it's going.
- Edit or delete a game from the list at the bottom.
- **Record match result…** logs a game from anywhere, without opening the tracker.
- Every deck note has a **Results** section (a `chrono-matches` block) with that deck's numbers and a **Log a game** button; see [[Somnus Revive]].

Games are saved in [[Match log]], one row per game, so you can also edit them by hand.
