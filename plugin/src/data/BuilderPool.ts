import type { CardRepository } from "./CardRepository";
import { allowedSyndicates, CardLookup, DIVER_COUNT, MAX_COPIES } from "./DeckRules";
import { Card, Deck, Syndicate } from "./types";

/** Filters of the deck builder's card pool. */
export interface PoolFilters {
	query: string;
	syndicates: ReadonlySet<Syndicate>;
	type: string;
	/** Exact cost, or {@link POOL_COST_MAX} and above. */
	cost: number | null;
	onlyPlayable: boolean;
}

export const POOL_COST_MAX = 7;

/** Syndicates "Only cards playable with my Divers" limits the pool to, or null when it doesn't apply. */
export function playableSyndicates(deck: Deck, cards: CardLookup, onlyPlayable: boolean): Set<Syndicate> | null {
	if (!onlyPlayable || deck.divers.length < DIVER_COUNT) return null;
	const allowed = allowedSyndicates(deck, cards);
	return allowed.size ? allowed : null;
}

/** Changes only when a deck edit changes which cards the pool shows (i.e. the Divers' syndicates). */
export function poolScopeKey(deck: Deck, cards: CardLookup, onlyPlayable: boolean): string {
	const allowed = playableSyndicates(deck, cards, onlyPlayable);
	return allowed ? Array.from(allowed).sort().join(",") : "";
}

/** Deck-legal cards matching the filters, cheapest first. */
export function poolCards(repo: CardRepository, deck: Deck, f: PoolFilters): Card[] {
	const allowed = playableSyndicates(deck, repo, f.onlyPlayable);
	const syndicates = f.syndicates.size ? Array.from(f.syndicates) : allowed ? Array.from(allowed) : undefined;
	let cards = repo.search(
		{
			text: f.query || undefined,
			syndicates,
			types: f.type ? [f.type] : undefined,
			minCost: f.cost ?? undefined,
			maxCost: f.cost === null || f.cost === POOL_COST_MAX ? undefined : f.cost,
		},
		2000,
	);
	if (allowed) cards = cards.filter((c) => c.syndicates.some((s) => allowed.has(s)));
	return cards.filter((c) => c.collectible !== false).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

export interface PoolCardState {
	/** Copies in the main deck. */
	count: number;
	isDiver: boolean;
	/** No more copies can be added. */
	maxed: boolean;
}

export function poolCardState(deck: Deck, id: number): PoolCardState {
	const count = deck.entries.find((e) => e.id === id)?.count ?? 0;
	const isDiver = deck.divers.includes(id);
	return { count, isDiver, maxed: isDiver || count >= MAX_COPIES };
}
