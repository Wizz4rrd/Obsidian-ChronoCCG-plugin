import { decodeDeck } from "./DeckCodec";
import { unwrapDeckCode } from "./deckInput";
import { Deck } from "./types";

/** Games per match: best of 1, 3 or 5. */
export type MatchFormat = "Bo1" | "Bo3" | "Bo5";

export const MATCH_FORMATS: MatchFormat[] = ["Bo1", "Bo3", "Bo5"];

export function gamesPerMatch(format: MatchFormat): number {
	return format === "Bo5" ? 5 : format === "Bo3" ? 3 : 1;
}

/**
 * The "Rounds" section of a tournament report: one heading per round, with a
 * row per game (as many as a match can last) to note which deck was played.
 */
export function tournamentRounds(format: MatchFormat, rounds: number): string {
	const games = gamesPerMatch(format);
	const out: string[] = [];
	for (let r = 1; r <= Math.max(1, rounds); r++) {
		out.push(`### Round ${r}`, "**Opponent:** ", games > 1 ? "**Result:** (e.g. 2-1)" : "**Result:** ", "");
		out.push("| Game | My deck | Their deck | Result | On the play? | Notes |", "| --: | --- | --- | --- | --- | --- |");
		for (let g = 1; g <= games; g++) out.push(`| ${g} |  |  |  |  |  |`);
		out.push("");
	}
	return out.join("\n");
}

/** Decks pasted as codes (one per line), for decks that have no note. `invalid` lists the 1-based lines that aren't deck codes. */
export function parseDeckCodes(text: string): { decks: Deck[]; invalid: number[] } {
	const decks: Deck[] = [];
	const invalid: number[] = [];
	text.split("\n").forEach((line, i) => {
		const code = unwrapDeckCode(line);
		if (!code) return;
		try {
			const d = decodeDeck(code);
			decks.push({ name: d.name.trim() || `Deck ${decks.length + 1}`, divers: d.divers, entries: d.entries });
		} catch {
			invalid.push(i + 1);
		}
	});
	return { decks, invalid };
}
