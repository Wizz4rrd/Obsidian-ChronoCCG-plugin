// Core domain types for ChronoCCG.
// Kept intentionally permissive while the game is in early access and the
// public schemas (runeterra.ar and custom sources) are still moving.

export type Syndicate =
	| "Lifeblood"
	| "Sungrace"
	| "Silence"
	| "Singularity"
	| "Splintergleam"
	| "Phasetide";

export const SYNDICATES: Syndicate[] = [
	"Lifeblood",
	"Sungrace",
	"Silence",
	"Singularity",
	"Splintergleam",
	"Phasetide",
];

/** Agents are permanents (and can be Divers); Actions are Slow / Fast / Immediate. */
// `string & {}` keeps editor autocomplete for the known values.
export type CardType = "Agent" | "Action" | "Timeline" | (string & {});

export type Rarity = "Common" | "Rare" | "Divergent" | "Lost" | (string & {});

export interface Card {
	/** Numeric id used by runeterra.ar image URLs. */
	id: number;
	name: string;
	syndicates: Syndicate[];
	type: CardType;
	cost: number;
	attack?: number;
	health?: number;
	rarity: Rarity;
	keywords: string[];
	text: string;
	/** Spell speed for actions (e.g. Immediate / Fast / Slow); empty for units. */
	spellSpeed?: string;
	/** Subtype line from data (e.g. Agent, Immortalized). */
	subtypes?: string[];
	flavor?: string;
	set?: string;
	artist?: string;
	/** False for tokens / immortalized forms that cannot be put in a deck. */
	collectible?: boolean;
	/** Optional override; otherwise resolved from settings.imageBase + id. */
	imageUrl?: string;
	/** Runeterra.ar full-bleed art (`*-full.webp`); in-game frame is usually `imageUrl`. */
	imageUrlFull?: string;
}

export interface DeckEntry {
	id: number;
	count: number;
}

export interface Deck {
	name: string;
	/** The two Diver card ids (each counted once, outside the 40-card main deck). */
	divers: number[];
	/** Main deck entries (Divers excluded). */
	entries: DeckEntry[];
	/** Original opaque deck code, if imported. */
	code?: string;
	notes?: string;
}

export interface CardDatabase {
	/** ISO date of when the dataset was generated upstream. */
	version: string;
	/** Source identifier ("bundled" | "runeterra.ar" | url). */
	source: string;
	cards: Card[];
}
