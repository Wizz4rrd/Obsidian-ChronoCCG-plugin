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

const noFilters: PoolFilters = { query: "", syndicates: new Set(), type: "", costs: new Set(), onlyPlayable: true };

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
		poolCards(cards, deck, { ...noFilters, costs: new Set([7]) }).map((c) => c.id),
		[14],
	);
	// Several costs at once; 7 stands for 7 and above.
	assert.deepEqual(
		poolCards(cards, deck, { ...noFilters, costs: new Set([2, 7]) }).map((c) => c.id),
		[11, 10, 14],
	);
	assert.ok(poolCards(cards, deck, { ...noFilters, onlyPlayable: false }).some((c) => c.id === 13));
});

test("pool card state counts copies and marks maxed cards", () => {
	const deck: Deck = { name: "", divers: [5], entries: [{ id: 7, count: 2 }, { id: 8, count: 3 }] };
	assert.deepEqual(poolCardState(deck, 7), { count: 2, isDiver: false, maxed: false });
	assert.deepEqual(poolCardState(deck, 8), { count: 3, isDiver: false, maxed: true });
	assert.deepEqual(poolCardState(deck, 5), { count: 0, isDiver: true, maxed: true });
});

test("search lists cards cheapest first, then by name, before applying the limit", () => {
	const cards = repo([card(1, { name: "Zed", cost: 5 }), card(2, { name: "Bo", cost: 1 }), card(3, { name: "Al", cost: 1 }), card(4, { cost: 0 })]);
	assert.deepEqual(
		cards.search({}).map((c) => c.id),
		[4, 3, 2, 1],
	);
	assert.deepEqual(
		cards.search({}, 2).map((c) => c.id),
		[4, 3],
	);
});

test("searching immortalize finds the cards whose effect is about it", () => {
	const cards = repo([
		card(1, { name: "Base", text: "Enter: Deal 4 to me.\nImmortalize: I see The One True Timeline." }),
		card(2, { name: "Flipped", type: "Immortalized Agent", text: "Overpower." }),
		card(3, { name: "Trigger", text: "Blitz. When I Immortalize, grant me +1/+1." }),
		card(4, { name: "Spell", type: "Action", text: "Revive an Immortalized ally." }),
	]);
	const ids = (text: string) => cards.search({ text }).map((c) => c.id);
	// Cheapest first, then by name: Spell, Trigger.
	assert.deepEqual(ids("immortalize"), [4, 3]);
	assert.deepEqual(ids("immortalized"), [4]);
	assert.deepEqual(ids("immortalise"), ids("immortalize"));
	assert.deepEqual(ids("immortal"), [4, 3]);
	// The condition itself is still found, and the Type filter still finds the immortalized side.
	assert.deepEqual(ids("timeline"), [1]);
	assert.deepEqual(cards.search({ types: ["Immortalized Agent"] }).map((c) => c.id), [2]);
});
