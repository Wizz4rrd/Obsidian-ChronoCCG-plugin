import { Card, Deck, Syndicate } from "./types";

/**
 * Deck construction rules from https://playchrono.com/rules:
 * - 42 cards: 2 Divers (Agents) + a 40-card main deck.
 * - Up to 3 copies of any card from the Syndicate(s) represented by the Divers.
 * - Copies of a Diver may not also be put into the main deck.
 */
export const DIVER_COUNT = 2;
export const MAIN_DECK_SIZE = 40;
export const MAX_COPIES = 3;

export type IssueLevel = "error" | "warning";

export interface DeckIssue {
	level: IssueLevel;
	message: string;
	/** Card the issue is about, when relevant. */
	cardId?: number;
}

export interface DeckStats {
	mainCount: number;
	uniqueCount: number;
	/** Index = cost, last bucket aggregates `curveMax`+. */
	curve: number[];
	byType: Record<string, number>;
	bySyndicate: Partial<Record<Syndicate, number>>;
	averageCost: number;
}

export interface CardLookup {
	getById(id: number): Card | undefined;
}

export const CURVE_MAX = 7;

export function isDiverEligible(card: Card): boolean {
	return card.collectible !== false && /agent|unit/i.test(card.type);
}

/** Syndicates the main deck may draw from (union of the Divers' syndicates). */
export function allowedSyndicates(deck: Deck, cards: CardLookup): Set<Syndicate> {
	const out = new Set<Syndicate>();
	for (const id of deck.divers) {
		for (const s of cards.getById(id)?.syndicates ?? []) out.add(s);
	}
	return out;
}

export function deckStats(deck: Deck, cards: CardLookup): DeckStats {
	const curve = new Array<number>(CURVE_MAX + 1).fill(0);
	const byType: Record<string, number> = {};
	const bySyndicate: Partial<Record<Syndicate, number>> = {};
	let mainCount = 0;
	let costSum = 0;
	let costed = 0;
	for (const e of deck.entries) {
		mainCount += e.count;
		const card = cards.getById(e.id);
		if (!card) continue;
		curve[Math.min(Math.max(card.cost, 0), CURVE_MAX)] += e.count;
		byType[card.type] = (byType[card.type] ?? 0) + e.count;
		for (const s of card.syndicates) bySyndicate[s] = (bySyndicate[s] ?? 0) + e.count;
		costSum += card.cost * e.count;
		costed += e.count;
	}
	return {
		mainCount,
		uniqueCount: deck.entries.length,
		curve,
		byType,
		bySyndicate,
		averageCost: costed ? costSum / costed : 0,
	};
}

export function validateDeck(deck: Deck, cards: CardLookup): DeckIssue[] {
	const issues: DeckIssue[] = [];
	const err = (message: string, cardId?: number) => issues.push({ level: "error", message, cardId });
	const warn = (message: string, cardId?: number) => issues.push({ level: "warning", message, cardId });

	// Divers
	if (deck.divers.length < DIVER_COUNT) {
		err(`Pick ${DIVER_COUNT} Divers (${deck.divers.length}/${DIVER_COUNT}).`);
	} else if (deck.divers.length > DIVER_COUNT) {
		err(`Too many Divers (${deck.divers.length}/${DIVER_COUNT}).`);
	}
	if (new Set(deck.divers).size !== deck.divers.length) err("The same card is used as both Divers.");
	for (const id of deck.divers) {
		const card = cards.getById(id);
		if (!card) warn(`Unknown Diver id ${id}.`, id);
		else if (!isDiverEligible(card)) err(`${card.name} cannot be a Diver (Divers must be Agents).`, id);
	}

	// Main deck
	const allowed = allowedSyndicates(deck, cards);
	const diverIds = new Set(deck.divers);
	const counts = new Map<number, number>();
	for (const e of deck.entries) counts.set(e.id, (counts.get(e.id) ?? 0) + e.count);

	let main = 0;
	for (const [id, count] of counts) {
		main += count;
		const card = cards.getById(id);
		const label = card?.name ?? `Card ${id}`;
		if (!card) warn(`Unknown card id ${id}.`, id);
		if (count > MAX_COPIES) err(`${label}: ${count} copies (max ${MAX_COPIES}).`, id);
		if (diverIds.has(id)) err(`${label} is a Diver and cannot also be in the main deck.`, id);
		if (card?.collectible === false) err(`${label} is not collectible.`, id);
		if (card && allowed.size && card.syndicates.length && !card.syndicates.some((s) => allowed.has(s))) {
			err(`${label} (${card.syndicates.join("/")}) is outside your Divers' syndicates.`, id);
		}
	}
	if (main < MAIN_DECK_SIZE) err(`Main deck has ${main}/${MAIN_DECK_SIZE} cards.`);
	else if (main > MAIN_DECK_SIZE) err(`Main deck has ${main}/${MAIN_DECK_SIZE} cards (too many).`);

	return issues;
}

export function isDeckLegal(deck: Deck, cards: CardLookup): boolean {
	return !validateDeck(deck, cards).some((i) => i.level === "error");
}
