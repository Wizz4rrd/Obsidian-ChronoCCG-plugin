import { normalizePath, Notice, TFile } from "obsidian";
import type ChronoCCGPlugin from "../../main";
import { deckCode, toCodeBlock } from "../data/DeckExport";
import { allowedSyndicates } from "../data/DeckRules";
import { Deck } from "../data/types";

export type TemplateKind = "deck" | "matchup" | "tournament";

export const TEMPLATE_FILE_NAMES: Record<TemplateKind, string> = {
	deck: "Deck.md",
	matchup: "Matchup.md",
	tournament: "Tournament report.md",
};

/**
 * Built-in note templates. Users can override any of them by putting a file
 * with the same name (see TEMPLATE_FILE_NAMES) in the configured template
 * folder. Placeholders: {{name}} {{date}} {{deck}} {{code}} {{divers}}
 * {{syndicates}} {{deckLink}} {{opponent}} {{event}}.
 */
export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
	deck: `---
type: chrono-deck
deck: "{{name}}"
syndicates: [{{syndicates}}]
divers: [{{divers}}]
code: {{code}}
created: {{date}}
status: testing
tags: [chronoccg/deck]
---
# {{name}}

{{deck}}
## Game plan
-

## Mulligan
Keep:
-

## Key cards & combos
-

## Matchups
| Opponent | Record | Notes |
| --- | --- | --- |
|  |  |  |

## Changelog
- {{date}} — created
`,
	matchup: `---
type: chrono-matchup
deck: "{{deckLink}}"
opponent: "{{opponent}}"
wins: 0
losses: 0
created: {{date}}
tags: [chronoccg/matchup]
---
# {{name}}

**My deck:** {{deckLink}}
**Opponent:** {{opponent}}

## Their key cards
- \`chrono:\`

## Mulligan
-

## Game plan
- Early:
- Mid:
- Late:

## Game log
| Date | Result | On the play? | Notes |
| --- | --- | --- | --- |
| {{date}} |  |  |  |
`,
	tournament: `---
type: chrono-tournament
event: "{{event}}"
date: {{date}}
deck: "{{deckLink}}"
record: 0-0
placement:
tags: [chronoccg/tournament]
---
# {{name}}

**Event:** {{event}}
**Deck:** {{deckLink}}

## Decklist
{{deck}}
## Rounds
| Round | Opponent | Their deck | Result | Notes |
| --: | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

## Takeaways
- What worked:
- What didn't:
- Changes for next time:
`,
};

export interface TemplateVars {
	name: string;
	deck?: Deck;
	deckLink?: string;
	opponent?: string;
	event?: string;
}

export class NoteTemplates {
	constructor(private plugin: ChronoCCGPlugin) {}

	async render(kind: TemplateKind, vars: TemplateVars): Promise<string> {
		const template = (await this.readUserTemplate(kind)) ?? DEFAULT_TEMPLATES[kind];
		const cards = this.plugin.cards;
		const deck = vars.deck;
		let code = "";
		if (deck && deck.divers.length) {
			try {
				code = deckCode(deck);
			} catch {
				code = "";
			}
		}
		const values: Record<string, string> = {
			name: vars.name,
			date: today(),
			deck: deck ? toCodeBlock(deck, cards) : "",
			code,
			divers: deck ? deck.divers.map((id) => yamlQuote(cards.getById(id)?.name ?? String(id))).join(", ") : "",
			syndicates: deck ? Array.from(allowedSyndicates(deck, cards)).join(", ") : "",
			deckLink: vars.deckLink ?? "",
			opponent: vars.opponent ?? "",
			event: vars.event ?? "",
		};
		return template.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in values ? values[key] : m));
	}

	private async readUserTemplate(kind: TemplateKind): Promise<string | null> {
		const folder = this.plugin.settings.templateFolder.trim();
		if (!folder) return null;
		const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${TEMPLATE_FILE_NAMES[kind]}`));
		return file instanceof TFile ? this.plugin.app.vault.read(file) : null;
	}

	/** Create a note in the configured folder and open it. */
	async createNote(kind: TemplateKind, vars: TemplateVars, subfolder: string): Promise<TFile | null> {
		try {
			const body = await this.render(kind, vars);
			const folder = normalizePath([this.plugin.settings.notesFolder.trim(), subfolder].filter(Boolean).join("/"));
			if (folder && folder !== "/" && !this.plugin.app.vault.getAbstractFileByPath(folder)) {
				await this.plugin.app.vault.createFolder(folder);
			}
			const base = sanitizeFileName(vars.name) || "Untitled";
			const path = await uniquePath(this.plugin, folder, base);
			const file = await this.plugin.app.vault.create(path, body);
			await this.plugin.app.workspace.getLeaf("tab").openFile(file);
			return file;
		} catch (err) {
			new Notice(`ChronoCCG: could not create note — ${(err as Error).message}`);
			return null;
		}
	}

	createDeckNote(deck: Deck): Promise<TFile | null> {
		return this.createNote("deck", { name: deck.name || "Untitled deck", deck }, "Decks");
	}

	createMatchupNote(deckLink: string, opponent: string): Promise<TFile | null> {
		const mine = deckLink.replace(/^\[\[|\]\]$/g, "") || "My deck";
		return this.createNote("matchup", { name: `${mine} vs ${opponent}`, deckLink, opponent }, "Matchups");
	}

	createTournamentNote(event: string, deckLink: string, deck?: Deck): Promise<TFile | null> {
		const name = `${today()} ${event}`;
		return this.createNote("tournament", { name, event, deckLink, deck }, "Tournaments");
	}
}

function yamlQuote(s: string): string {
	return JSON.stringify(s);
}

export function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function uniquePath(plugin: ChronoCCGPlugin, folder: string, base: string): Promise<string> {
	const prefix = folder && folder !== "/" ? `${folder}/` : "";
	let candidate = normalizePath(`${prefix}${base}.md`);
	for (let i = 1; await plugin.app.vault.adapter.exists(candidate); i++) {
		candidate = normalizePath(`${prefix}${base} (${i}).md`);
	}
	return candidate;
}

/** Local date as YYYY-MM-DD. */
function today(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
