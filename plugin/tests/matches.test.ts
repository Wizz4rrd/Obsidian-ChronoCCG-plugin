import { test } from "node:test";
import assert from "node:assert/strict";
import {
	addLogRow,
	comparePatches,
	currentStreak,
	deckCellLabel,
	deckLinkTarget,
	formatLogRow,
	groupRecords,
	matchesVs,
	weekOf,
	weeklyRecords,
	logColumns,
	logTableHeader,
	Match,
	pairingLabel,
	parseLog,
	replaceLogRow,
	tableCells,
	tally,
	upgradeLog,
	winRate,
} from "../src/data/matches";

/** The columns of a log written before Patch and Opponent deck existed; "Turn" was dropped since, and is left alone. */
const OLD_COLUMNS = ["Date", "Deck", "Result", "Opponent", "Archetype", "Turn", "Note"];
const log = (...rows: string[]) => `# Match log\n\n${logTableHeader(OLD_COLUMNS)}\n${rows.join("\n")}\n`;
const game = (m: Partial<Match>): Match => ({ date: "", patch: "", result: "W", opponent: [], archetype: "", opponentDeck: "", note: "", ...m });

test("log rows are parsed leniently, header and separator skipped", () => {
	const { rows, invalid } = parseLog(
		log(
			"| 2026-11-15 | [[Somnus Revive]] | win | sungrace / Silence | Aggro | otp | topdecked \\| lethal |",
			"| 2026-11-15 | Dino Swoop | D | Silence |",
			"| | [[Egg Novice]] | L |",
		),
	);
	assert.deepEqual(invalid, [6]);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0].match, game({ date: "2026-11-15", opponent: ["Sungrace", "Silence"], archetype: "Aggro", note: "topdecked | lethal" }));
	assert.equal(rows[0].deck, "[[Somnus Revive]]");
	assert.deepEqual(rows[1].match, game({ result: "L" }));
});

test("rows round-trip, with pipes escaped", () => {
	const row = formatLogRow("[[Decks/Somnus Revive|Somnus]]", game({ date: "2026-11-15", patch: "0.11.1", result: "L", opponent: ["Silence"], opponentDeck: "AUGVG33N", note: "a | b" }));
	assert.equal(row, "| 2026-11-15 | 0.11.1 | [[Decks/Somnus Revive\\|Somnus]] | L | Silence |  | AUGVG33N | a \\| b |");
	const [parsed] = parseLog(`${logTableHeader()}\n${row}`).rows;
	assert.equal(parsed.match.patch, "0.11.1");
	assert.equal(parsed.match.opponentDeck, "AUGVG33N");
	assert.equal(parsed.deck, "[[Decks/Somnus Revive|Somnus]]");
	assert.equal(parsed.match.note, "a | b");
	assert.equal(parsed.raw, row);
	assert.deepEqual(tableCells("not a row"), null);
});

test("deck cells: link target and label", () => {
	assert.equal(deckLinkTarget("[[Decks/Somnus Revive|Somnus]]"), "Decks/Somnus Revive");
	assert.equal(deckLinkTarget("[[Egg Novice#Matchups]]"), "Egg Novice");
	assert.equal(deckLinkTarget("Egg Novice"), null);
	assert.equal(deckCellLabel("[[Decks/Somnus Revive|Somnus]]"), "Somnus");
	assert.equal(deckCellLabel("[[Decks/Somnus Revive]]"), "Somnus Revive");
	assert.equal(deckCellLabel("Egg Novice"), "Egg Novice");
	// Markdown links, for vaults with "Use [[Wikilinks]]" off.
	assert.equal(deckLinkTarget("[Somnus Revive](Decks/Somnus%20Revive.md)"), "Decks/Somnus Revive");
	assert.equal(deckLinkTarget("[Somnus](<../Decks/Somnus Revive.md#Matchups>)"), "../Decks/Somnus Revive");
	assert.equal(deckCellLabel("[Somnus](Decks/Somnus%20Revive.md)"), "Somnus");
});

test("columns are read by header, and an old log gets the new ones", () => {
	const old = log("| 2026-11-01 | [[A]] | W | Silence | Aggro | play | gg |");
	assert.deepEqual(logColumns(old), OLD_COLUMNS);
	const upgraded = upgradeLog(old);
	assert.deepEqual(logColumns(upgraded), ["Date", "Deck", "Result", "Opponent", "Archetype", "Turn", "Patch", "Opponent deck", "Note"]);
	assert.ok(upgraded.includes("| 2026-11-01 | [[A]] | W | Silence | Aggro | play |  |  | gg |"));
	assert.deepEqual(parseLog(upgraded).rows[0].match, parseLog(old).rows[0].match);
	assert.equal(upgradeLog(upgraded), upgraded);
	// Reordered and extra columns: rows follow the header, unknown cells are kept on edit.
	const custom = "| Result | Deck | Mood | Date |\n| --- | --- | --- | --- |\n| L | [[B]] | tilted | 2026-11-02 |";
	const [row] = parseLog(custom).rows;
	assert.equal(row.match.date, "2026-11-02");
	assert.equal(row.deck, "[[B]]");
	assert.equal(formatLogRow("[[B]]", { ...row.match, result: "W" }, logColumns(custom), row.raw), "| W | [[B]] | tilted | 2026-11-02 |");
});

test("patches sort newest first", () => {
	assert.deepEqual(["0.9.2", "0.10.0", "0.9.10", "beta", "v1.0"].sort(comparePatches), ["v1.0", "0.10.0", "0.9.10", "0.9.2", "beta"]);
});

test("rows are added to the table, which is created when missing", () => {
	const row = "| 2026-11-15 | [[A]] | W |  |  |  |  |";
	assert.equal(addLogRow("", row), `${logTableHeader()}\n${row}\n`);
	assert.equal(addLogRow("# Match log\n", row), `# Match log\n\n${logTableHeader()}\n${row}\n`);
	const withText = `${log("| x | [[B]] | L |")}\nNotes below the table.\n`;
	const added = addLogRow(withText, row);
	assert.deepEqual(parseLog(added).rows.map((r) => r.deck), ["[[B]]", "[[A]]"]);
	assert.ok(added.endsWith("Notes below the table.\n"));
});

test("rows are replaced and removed by their text", () => {
	const text = log("| 1 | [[A]] | W |", "| 2 | [[A]] | L |");
	assert.deepEqual(parseLog(replaceLogRow(text, "| 1 | [[A]] | W |", "| 1 | [[A]] | L |")!).rows.map((r) => r.match.result), ["L", "L"]);
	assert.deepEqual(parseLog(replaceLogRow(text, "| 2 | [[A]] | L |", null)!).rows.map((r) => r.match.date), ["1"]);
	assert.equal(replaceLogRow(text, "| 3 | [[A]] | W |", null), null);
});

test("records, win rate, groups and streak", () => {
	const { rows } = parseLog(log("| | A | W | Silence |", "| | A | L | Silence |", "| | A | W | Sungrace |", "| | A | L | Sungrace |", "| | A | W | Sungrace |"));
	const matches = rows.map((r) => r.match);
	assert.deepEqual(tally(matches), { wins: 3, losses: 2, games: 5 });
	assert.equal(winRate(tally(matches)), 0.6);
	assert.equal(winRate(tally([])), null);
	assert.deepEqual(
		groupRecords(matches, (m) => pairingLabel(m.opponent), (m) => m).map((g) => [g.key, g.record.games]),
		[
			["Sungrace", 3],
			["Silence", 2],
		],
	);
	assert.deepEqual(currentStreak(matches), { result: "W", count: 1 });
});


test("vs filter and weekly records", () => {
	assert.equal(matchesVs(["Silence", "Sungrace"], []), true);
	assert.equal(matchesVs(["Silence", "Sungrace"], ["Silence"]), true);
	assert.equal(matchesVs(["Silence", "Sungrace"], ["Sungrace", "Silence"]), true);
	assert.equal(matchesVs(["Silence"], ["Silence", "Sungrace"]), false);
	assert.equal(weekOf("2026-11-17"), "2026-11-16");
	assert.equal(weekOf("2026-11-16"), "2026-11-16");
	assert.equal(weekOf("2026-11-15"), "2026-11-09");
	assert.equal(weekOf(""), null);
	const weeks = weeklyRecords([game({ date: "2026-11-17" }), game({ date: "2026-11-03", result: "L" }), game({ date: "2026-11-18", result: "L" }), game({})]);
	assert.deepEqual(weeks, [
		{ week: "2026-11-02", record: { wins: 0, losses: 1, games: 1 } },
		{ week: "2026-11-16", record: { wins: 1, losses: 1, games: 2 } },
	]);
});
