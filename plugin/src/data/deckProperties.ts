import { deckCode } from "./DeckExport";
import { allowedSyndicates, CardLookup } from "./DeckRules";
import { Deck } from "./types";

/** `type` property of notes made from the deck template. */
export const DECK_NOTE_TYPE = "chrono-deck";

/** Properties of a deck note that are derived from its (first) deck block. */
export interface DeckProperties {
	deck: string;
	syndicates: string[];
	divers: string[];
	code: string;
}

export type DeckPropertyKey = keyof DeckProperties;

const DERIVED_KEYS: DeckPropertyKey[] = ["deck", "syndicates", "divers", "code"];

/** The values the deck template writes for `deck`. */
export function deckProperties(deck: Deck, cards: CardLookup): DeckProperties {
	let code = "";
	if (deck.divers.length) {
		try {
			code = deckCode(deck);
		} catch {
			code = "";
		}
	}
	return {
		deck: deck.name,
		syndicates: Array.from(allowedSyndicates(deck, cards)),
		divers: deck.divers.map((id) => cards.getById(id)?.name ?? String(id)),
		code,
	};
}

/**
 * Derived properties whose value in `frontmatter` differs from `expected`.
 * Properties the note doesn't have are left alone (custom templates), and so
 * is the deck name when the block has none.
 */
export function staleProperties(frontmatter: Record<string, unknown>, expected: DeckProperties): DeckPropertyKey[] {
	return DERIVED_KEYS.filter((key) => {
		if (!(key in frontmatter) || (key === "deck" && !expected.deck)) return false;
		return !sameValue(frontmatter[key], expected[key]);
	});
}

/** Lists compare without order: `[Silence, Sungrace]` and `[Sungrace, Silence]` are the same Divers. */
function sameValue(actual: unknown, expected: string | string[]): boolean {
	if (Array.isArray(expected)) {
		const list = Array.isArray(actual) ? actual.map(text) : text(actual) ? [text(actual)] : [];
		return list.length === expected.length && list.slice().sort().join("\n") === expected.slice().sort().join("\n");
	}
	return text(actual) === expected;
}

/** A YAML scalar as text ("" for empty values). */
function text(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return value === null || value === undefined ? "" : JSON.stringify(value);
}
