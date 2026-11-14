import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeDeck } from "../src/data/DeckCodec";
import { findFirstDeckBlock } from "../src/data/deckInput";
import { deckProperties, staleProperties } from "../src/data/deckProperties";
import { Card, Deck } from "../src/data/types";

function card(id: number, over: Partial<Card> = {}): Card {
	return { id, name: `Card ${id}`, syndicates: ["Silence"], type: "Agent", cost: 1, rarity: "Common", keywords: [], text: "", ...over };
}
const cards = new Map([card(1, { name: "Ana", syndicates: ["Silence"] }), card(2, { name: "Bo", syndicates: ["Sungrace"] }), card(3)].map((c) => [c.id, c]));
const lookup = { getById: (id: number) => cards.get(id) };
const deck: Deck = { name: "Test", divers: [1, 2], entries: [{ id: 3, count: 3 }] };

test("deck note properties are derived from the deck", () => {
	const p = deckProperties(deck, lookup);
	assert.equal(p.deck, "Test");
	assert.deepEqual(p.divers, ["Ana", "Bo"]);
	assert.deepEqual(p.syndicates, ["Silence", "Sungrace"]);
	const decoded = decodeDeck(p.code);
	assert.deepEqual([decoded.name, decoded.divers, decoded.entries], ["Test", [1, 2], [{ id: 3, count: 3 }]]);
	assert.equal(deckProperties({ name: "", divers: [], entries: [] }, lookup).code, "");
});

test("only properties the note has, with another value, are out of date", () => {
	const p = deckProperties(deck, lookup);
	const fm = { type: "chrono-deck", deck: "Test", syndicates: ["Sungrace", "Silence"], divers: ["Bo", "Ana"], code: p.code, status: "testing" };
	assert.deepEqual(staleProperties(fm, p), []);
	assert.deepEqual(staleProperties({ ...fm, divers: ["Ana", "Card 3"], code: "OLD" }, p), ["divers", "code"]);
	assert.deepEqual(staleProperties({ type: "chrono-deck", divers: ["Ana"] }, p), ["divers"]);
	assert.deepEqual(staleProperties({ ...fm, deck: "Old name" }, { ...p, deck: "" }), []);
	const empty = deckProperties({ name: "", divers: [], entries: [] }, lookup);
	assert.deepEqual(staleProperties({ syndicates: [], divers: null, code: null }, empty), []);
});

test("finds the first deck block of a note", () => {
	const lines = ["# Deck", "```chrono-deck", "name: A", "```", "", "```chrono-deck", "name: B", "```"];
	assert.deepEqual(findFirstDeckBlock(lines), { start: 1, end: 3 });
	assert.equal(findFirstDeckBlock(["# No deck", "```js", "x", "```"]), null);
});
