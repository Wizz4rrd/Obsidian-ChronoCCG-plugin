import { test } from "node:test";
import assert from "node:assert/strict";
import { PoolFilters, poolCards, poolCardState, poolScopeKey } from "../src/data/BuilderPool";
import { CardRepository } from "../src/data/CardRepository";
import { Card, Deck } from "../src/data/types";

function card(id: number, over: Partial<Card> = {}): Card {
	return { id, name: `Card ${id}`, syndicates: ["Silence"], type: "Agent", cost: 1, rarity: "Common", keywords: [], text: "", ...over };
}

function repo(cards: Card[]): CardRepository {
	const r = new CardRepository();
	r.load({ version: "test", source: "test", cards });
	return r;
}

const noFilters: PoolFilters = { query: "", syndicates: new Set(), type: "", cost: null, onlyPlayable: true };

test("the pool is only rebuilt when the Divers' syndicates change", () => {
	const cards = repo([card(1, { syndicates: ["Silence"] }), card(2, { syndicates: ["Sungrace"] }), card(3)]);
	const deck: Deck = { name: "", divers: [1], entries: [] };
	const oneDiver = poolScopeKey(deck, cards, true);
	deck.entries.push({ id: 3, count: 2 });
	assert.equal(poolScopeKey(deck, cards, true), oneDiver);
	deck.divers.push(2);
	const twoDivers = poolScopeKey(deck, cards, true);
	assert.notEqual(twoDivers, oneDiver);
	assert.equal(poolScopeKey(deck, cards, false), "");
});

test("pool shows deck-legal cards of the Divers' syndicates, cheapest first", () => {
	const cards = repo([
		card(1, { syndicates: ["Silence"] }),
		card(2, { syndicates: ["Sungrace"] }),
		card(10, { name: "Zed", cost: 2 }),
		card(11, { name: "Abe", cost: 2 }),
		card(12, { cost: 0, collectible: false }),
		card(13, { syndicates: ["Phasetide"], cost: 0 }),
		card(14, { cost: 9 }),
	]);
	const deck: Deck = { name: "", divers: [1, 2], entries: [] };
	assert.deepEqual(
		poolCards(cards, deck, noFilters).map((c) => c.id),
		[1, 2, 11, 10, 14],
	);
	assert.deepEqual(
		poolCards(cards, deck, { ...noFilters, cost: 7 }).map((c) => c.id),
		[14],
	);
	assert.ok(poolCards(cards, deck, { ...noFilters, onlyPlayable: false }).some((c) => c.id === 13));
});

test("pool card state counts copies and marks maxed cards", () => {
	const deck: Deck = { name: "", divers: [5], entries: [{ id: 7, count: 2 }, { id: 8, count: 3 }] };
	assert.deepEqual(poolCardState(deck, 7), { count: 2, isDiver: false, maxed: false });
	assert.deepEqual(poolCardState(deck, 8), { count: 3, isDiver: false, maxed: true });
	assert.deepEqual(poolCardState(deck, 5), { count: 0, isDiver: true, maxed: true });
});
