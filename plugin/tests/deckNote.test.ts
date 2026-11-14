import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeDeck } from "../src/data/DeckCodec";
import { logDeckChange } from "../src/data/deckChangelog";
import { findFirstDeckBlock, locateDeckBlock } from "../src/data/deckInput";
import { deckProperties, staleProperties } from "../src/data/deckProperties";
import { parseDeckCodes, tournamentRounds } from "../src/data/tournament";
import { Card, Deck } from "../src/data/types";

function card(id: number, over: Partial<Card> = {}): Card {
	return { id, name: `Card ${id}`, syndicates: ["Silence"], type: "Agent", cost: 1, rarity: "Common", keywords: [], text: "", ...over };
}
const cards = new Map(
	[card(1, { name: "Ana", syndicates: ["Silence"] }), card(2, { name: "Bo", syndicates: ["Sungrace"] }), card(3), card(4, { name: "Boof, Lonely and Proud" }), card(5, { name: "Cy" })].map(
		(c) => [c.id, c],
	),
);
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

const NOTE = ["# Test", "", "## Changelog", "- 2026-11-01 — created", "", "## Notes", "text"].join("\n");

test("logs a builder save under the Changelog heading", () => {
	const after: Deck = { name: "Renamed", divers: [1, 5], entries: [{ id: 3, count: 1 }, { id: 4, count: 2 }] };
	const out = logDeckChange(NOTE, deck, after, lookup, "2026-11-14").split("\n");
	assert.equal(
		out[4],
		"- 2026-11-14 — renamed “Test” → “Renamed”, Diver `chrono:Bo` → `chrono:Cy`, +2 `chrono:Boof, Lonely and Proud`, −2 `chrono:Card 3`",
	);
	assert.deepEqual(out.slice(5), ["", "## Notes", "text"]);
	assert.equal(logDeckChange(NOTE.replace("## Changelog", "## History"), deck, after, lookup, "2026-11-14"), NOTE.replace("## Changelog", "## History"));
	assert.equal(logDeckChange(NOTE, deck, deck, lookup, "2026-11-14"), NOTE);
});

test("saves on the same day merge into one changelog line", () => {
	const plus: Deck = { ...deck, entries: [{ id: 3, count: 3 }, { id: 4, count: 1 }] };
	const first = logDeckChange(NOTE, deck, plus, lookup, "2026-11-14");
	const swapped: Deck = { ...plus, entries: [{ id: 3, count: 2 }, { id: 4, count: 2 }] };
	const second = logDeckChange(first, plus, swapped, lookup, "2026-11-14");
	assert.equal(second.split("\n")[4], "- 2026-11-14 — +2 `chrono:Boof, Lonely and Proud`, −1 `chrono:Card 3`");
	assert.equal(second.split("\n").length, NOTE.split("\n").length + 1);
	// Renaming and renaming back on the same day cancels out.
	const renamed = logDeckChange(first, plus, { ...plus, name: "New" }, lookup, "2026-11-14");
	assert.equal(renamed.split("\n")[4], "- 2026-11-14 — renamed “Test” → “New”, +1 `chrono:Boof, Lonely and Proud`");
	assert.equal(logDeckChange(renamed, { ...plus, name: "New" }, plus, lookup, "2026-11-14"), first);
	// Undoing everything removes the line again.
	assert.equal(logDeckChange(second, swapped, deck, lookup, "2026-11-14"), NOTE);
	// A line with the user's own words is never rewritten.
	const own = NOTE.replace("2026-11-01 — created", "2026-11-14 — +1 `chrono:Ana` for the mirror");
	assert.equal(logDeckChange(own, deck, plus, lookup, "2026-11-14").split("\n").length, NOTE.split("\n").length + 1);
});

test("finds the builder's block again after the note changed above it", () => {
	const lines = ["# Deck", "```chrono-deck", "name: A", "```", "```chrono-deck", "name: B", "```"];
	assert.deepEqual(locateDeckBlock(lines, { lineStart: 4, body: "name: B" }), { start: 4, end: 6 });
	const shifted = ["# Deck", "new line", ...lines.slice(1)];
	assert.deepEqual(locateDeckBlock(shifted, { lineStart: 4, body: "name: B" }), { start: 5, end: 7 });
	assert.equal(locateDeckBlock(shifted, { lineStart: 4 }), null);
	assert.equal(locateDeckBlock(shifted, { lineStart: 4, body: "name: C" }), null);
	// Another deck block moved onto the line: found by its content instead.
	const moved = ["# Deck", "```chrono-deck", "name: B", "```", "x", "```chrono-deck", "name: A", "```"];
	assert.deepEqual(locateDeckBlock(moved, { lineStart: 5, body: "name: B" }), { start: 1, end: 3 });
	// The block was edited by hand: its position still counts.
	assert.deepEqual(locateDeckBlock(moved, { lineStart: 5, body: "name: Z" }), { start: 5, end: 7 });
});

test("tournament rounds have a row per game of the format", () => {
	const bo3 = tournamentRounds("Bo3", 2).split("\n");
	assert.deepEqual(
		bo3.filter((l) => l.startsWith("### ")),
		["### Round 1", "### Round 2"],
	);
	assert.equal(bo3.filter((l) => /^\| \d \|/.test(l)).length, 6);
	assert.equal(tournamentRounds("Bo5", 1).split("\n").filter((l) => /^\| \d \|/.test(l)).length, 5);
	assert.equal(tournamentRounds("Bo1", 0).split("\n").filter((l) => /^\| \d \|/.test(l)).length, 1);
});

test("reads pasted deck codes for a tournament report, one per line", () => {
	const code = "AUGVG33NNZ2XGICSMV3GS5TFBNRW63TTORZHKY3UMVSHUAACAEAAFBIBA4GGMAYMAMHAGCADNUBQEAYZAMBQGAQDAMBQEAYCAM";
	const { decks, invalid } = parseDeckCodes(`${code}\n\n  \`${code}\`  \nnot a code`);
	assert.equal(decks.length, 2);
	assert.equal(decks[0].divers.length, 2);
	assert.ok(decks[0].name);
	assert.deepEqual(invalid, [4]);
	assert.deepEqual(parseDeckCodes(""), { decks: [], invalid: [] });
});
