import { encodeDeck } from "./DeckCodec";
import { CardLookup, deckStats } from "./DeckRules";
import { Card, Deck, DeckEntry } from "./types";

/** Cards sorted the way players read a list: cost, then name. */
export function sortEntries(entries: DeckEntry[], cards: CardLookup): DeckEntry[] {
	return entries.slice().sort((a, b) => {
		const ca = cards.getById(a.id);
		const cb = cards.getById(b.id);
		const dc = (ca?.cost ?? 99) - (cb?.cost ?? 99);
		if (dc !== 0) return dc;
		return (ca?.name ?? String(a.id)).localeCompare(cb?.name ?? String(b.id));
	});
}

export function deckCode(deck: Deck): string {
	return encodeDeck({ name: deck.name, divers: deck.divers, entries: deck.entries });
}

/** A ```chrono-deck block in the YAML flavour (card names kept as comments). */
export function toCodeBlock(deck: Deck, cards: CardLookup): string {
	const lines = ["```chrono-deck", `name: ${yamlString(deck.name || "Untitled deck")}`];
	lines.push("divers:");
	for (const id of deck.divers) lines.push(`  - ${id}${comment(cards.getById(id))}`);
	lines.push("cards:");
	for (const e of sortEntries(deck.entries, cards)) {
		lines.push(`  - { id: ${e.id}, count: ${e.count} }${comment(cards.getById(e.id))}`);
	}
	lines.push("```");
	return lines.join("\n") + "\n";
}

export function toMarkdownTable(deck: Deck, cards: CardLookup): string {
	const rows = ["| Qty | Card | Cost | Type | Syndicate | Rarity |", "| --: | --- | --: | --- | --- | --- |"];
	const row = (qty: string, id: number) => {
		const c = cards.getById(id);
		const cell = (s: string) => s.replace(/\|/g, "\\|");
		rows.push(
			`| ${qty} | ${cell(c?.name ?? `#${id}`)} | ${c?.cost ?? "?"} | ${cell(c?.type ?? "?")} | ${cell(
				c?.syndicates.join(" / ") ?? "?",
			)} | ${cell(c?.rarity ?? "?")} |`,
		);
	};
	for (const id of deck.divers) row("Diver", id);
	for (const e of sortEntries(deck.entries, cards)) row(String(e.count), e.id);
	const stats = deckStats(deck, cards);
	return `**${deck.name || "Untitled deck"}** — ${stats.mainCount} cards + ${deck.divers.length} Divers\n\n${rows.join("\n")}\n`;
}

export function toPlainList(deck: Deck, cards: CardLookup): string {
	const lines = [`name: ${deck.name || "Untitled deck"}`];
	for (const id of deck.divers) lines.push(`D ${cards.getById(id)?.name ?? id}`);
	for (const e of sortEntries(deck.entries, cards)) lines.push(`${e.count} ${cards.getById(e.id)?.name ?? e.id}`);
	return lines.join("\n") + "\n";
}

export function toJson(deck: Deck, cards: CardLookup): string {
	const describe = (id: number) => {
		const c = cards.getById(id);
		return c ? { name: c.name, cost: c.cost, type: c.type, syndicates: c.syndicates, rarity: c.rarity } : {};
	};
	let code: string | undefined;
	try {
		code = deckCode(deck);
	} catch {
		code = undefined;
	}
	return JSON.stringify(
		{
			name: deck.name,
			code,
			divers: deck.divers.map((id) => ({ id, ...describe(id) })),
			cards: sortEntries(deck.entries, cards).map((e) => ({ id: e.id, count: e.count, ...describe(e.id) })),
		},
		null,
		2,
	);
}

function comment(card: Card | undefined): string {
	return card ? ` # ${card.name.replace(/[\r\n]/g, " ")}` : "";
}

function yamlString(s: string): string {
	return /[:#"'\n[\]{},&*!|>%@`]/.test(s) || /^\s|\s$/.test(s) ? JSON.stringify(s) : s;
}
