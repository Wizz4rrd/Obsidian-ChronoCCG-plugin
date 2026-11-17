import { Syndicate, SYNDICATES } from "./types";

/**
 * The match log: one note with a Markdown table, one row per game, written by
 * the match tracker and editable by hand.
 *
 *   | Date | Patch | Deck | Result | Opponent | Archetype | Opponent deck | Note |
 *   | --- | --- | --- | --- | --- | --- | --- | --- |
 *   | 2026-11-15 | 0.11.1 | [[Somnus Revive]] | W | Sungrace Silence | Eggs | AUGVG33… | topdecked lethal |
 *
 * Columns are found by their header, so they can be reordered, and a log
 * written before a column existed still reads (it gets the column on the next
 * write). Columns it doesn't know (e.g. an old "Turn" or "Style") are kept as they are.
 * Only the result is required. Chrono games can't end in a draw.
 */
export const LOG_COLUMNS = ["Date", "Patch", "Deck", "Result", "Opponent", "Archetype", "Opponent deck", "Note"];

type Field = "date" | "patch" | "deck" | "result" | "opponent" | "archetype" | "opponentDeck" | "note";

const FIELD_NAMES: Record<Field, string[]> = {
	date: ["date"],
	patch: ["patch", "version"],
	deck: ["deck"],
	result: ["result"],
	opponent: ["opponent", "vs"],
	archetype: ["archetype"],
	opponentDeck: ["opponent deck", "opp. deck", "opp deck", "opponent deck code"],
	note: ["note", "notes"],
};

function fieldOf(header: string): Field | null {
	const h = header.trim().toLowerCase();
	return (Object.keys(FIELD_NAMES) as Field[]).find((f) => FIELD_NAMES[f].includes(h)) ?? null;
}

export type MatchResult = "W" | "L";

export interface Match {
	/** YYYY-MM-DD, or "" when not noted. */
	date: string;
	/** Game version, e.g. "0.11.1", or "". */
	patch: string;
	result: MatchResult;
	/** Opponent's syndicates, in SYNDICATES order (empty when unknown). */
	opponent: Syndicate[];
	/** Opponent's archetype or deck nickname, e.g. "Eggs", or "". */
	archetype: string;
	/** Opponent's deck code, or "". */
	opponentDeck: string;
	note: string;
}

/** A row of the log: the deck cell as written (usually a link) and the game. */
export interface LogRow {
	deck: string;
	match: Match;
	/** The line as it is in the note, to find it again when editing or deleting. */
	raw: string;
}

export interface MatchRecord {
	wins: number;
	losses: number;
	games: number;
}

export function parseResult(text: string): MatchResult | null {
	const t = text.trim().toLowerCase();
	if (/^(w|win|won|victory)$/.test(t)) return "W";
	if (/^(l|loss|lose|lost|defeat)$/.test(t)) return "L";
	return null;
}

export function parseSyndicates(text: string): Syndicate[] {
	return SYNDICATES.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(text));
}

/** Cells of a table row ("| a | b |"), with "\|" unescaped; null when the line isn't one. */
export function tableCells(line: string): string[] | null {
	const t = line.trim();
	if (!t.startsWith("|")) return null;
	// Split on "|" but not "\|" (no regex lookbehind: older iOS lacks it).
	const cells: string[] = [];
	let current = "";
	for (let i = 1; i < t.length; i++) {
		if (t[i] === "\\" && t[i + 1] === "|") {
			current += "|";
			i++;
		} else if (t[i] === "|") {
			cells.push(current.trim());
			current = "";
		} else current += t[i];
	}
	if (current.trim()) cells.push(current.trim());
	return cells;
}

function isSeparator(cells: string[]): boolean {
	return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function isHeader(cells: string[]): boolean {
	const fields = cells.map(fieldOf);
	return fields.includes("date") && fields.includes("result");
}

/** The log table's header line (0-based) and column names, or null when the note has no table yet. */
function findHeader(lines: string[]): { line: number; columns: string[] } | null {
	for (let i = 0; i < lines.length; i++) {
		const cells = tableCells(lines[i]);
		if (cells && isHeader(cells)) return { line: i, columns: cells };
	}
	return null;
}

/** The games of a log note. `invalid` lists the 1-based lines of table rows without a W or L result. */
export function parseLog(text: string): { rows: LogRow[]; invalid: number[] } {
	const rows: LogRow[] = [];
	const invalid: number[] = [];
	let fields = LOG_COLUMNS.map(fieldOf);
	text.split("\n").forEach((line, i) => {
		const cells = tableCells(line);
		if (!cells || isSeparator(cells)) return;
		if (isHeader(cells)) return void (fields = cells.map(fieldOf));
		const get = (f: Field): string => {
			const at = fields.indexOf(f);
			if (at < 0) return "";
			// A hand-typed "|" in the last column splits it: keep the rest.
			return at === fields.length - 1 ? cells.slice(at).join(" | ") : (cells[at] ?? "");
		};
		const r = parseResult(get("result"));
		if (!r) return void invalid.push(i + 1);
		rows.push({
			deck: get("deck"),
			raw: line,
			match: {
				date: get("date"),
				patch: get("patch"),
				result: r,
				opponent: parseSyndicates(get("opponent")),
				archetype: get("archetype"),
				opponentDeck: get("opponentDeck").replace(/\s+/g, ""),
				note: get("note"),
			},
		});
	});
	return { rows, invalid };
}

function cell(text: string): string {
	return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/**
 * A row for the table with `columns` (the log's header). Columns the tracker
 * doesn't know keep their cell from `previous` (the row being edited).
 */
export function formatLogRow(deck: string, m: Match, columns: string[] = LOG_COLUMNS, previous?: string): string {
	const old = (previous && tableCells(previous)) || [];
	const value: Record<Field, string> = {
		date: m.date,
		patch: m.patch,
		deck,
		result: m.result,
		opponent: m.opponent.join(" "),
		archetype: m.archetype,
		opponentDeck: m.opponentDeck,
		note: m.note,
	};
	const cells = columns.map((c, i) => {
		const f = fieldOf(c);
		return f ? cell(value[f]) : cell(old[i] ?? "");
	});
	return `| ${cells.join(" | ")} |`;
}

export function logTableHeader(columns: string[] = LOG_COLUMNS): string {
	return `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
}

/** The columns rows of `text` are written with: its table's header, or LOG_COLUMNS. */
export function logColumns(text: string): string[] {
	return findHeader(text.split("\n"))?.columns ?? LOG_COLUMNS;
}

/**
 * `text` with the columns of LOG_COLUMNS its table lacks added (before Note,
 * else at the end), every row padded to match. Unchanged when nothing is missing.
 */
export function upgradeLog(text: string): string {
	const lines = text.split("\n");
	const header = findHeader(lines);
	if (!header) return text;
	const have = header.columns.map(fieldOf);
	const missing = LOG_COLUMNS.filter((c) => !have.includes(fieldOf(c)));
	if (!missing.length) return text;
	const noteAt = have.indexOf("note");
	const at = noteAt >= 0 ? noteAt : have.length;
	const insert = (cells: string[], added: string[]) => [...cells.slice(0, at), ...added, ...cells.slice(at)];
	const columns = insert(header.columns, missing);
	lines[header.line] = logTableHeader(columns).split("\n")[0];
	for (let i = header.line + 1; i < lines.length; i++) {
		const cells = tableCells(lines[i]);
		if (!cells) break;
		const padded = header.columns.map((_, c) => cells[c] ?? "");
		if (isSeparator(cells)) lines[i] = logTableHeader(columns).split("\n")[1];
		else lines[i] = `| ${insert(padded, missing.map(() => "")).map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
	}
	return lines.join("\n");
}

/** `text` with `row` added at the end of its log table; the table is created when the note has none. */
export function addLogRow(text: string, row: string): string {
	const lines = text.split("\n");
	const header = findHeader(lines);
	if (header) {
		let end = header.line + 1;
		while (end < lines.length && tableCells(lines[end])) end++;
		lines.splice(end, 0, row);
		return lines.join("\n");
	}
	const before = text.replace(/\s*$/, "");
	return `${before ? `${before}\n\n` : ""}${logTableHeader()}\n${row}\n`;
}

/** `text` with the line `raw` replaced by `next` (or removed when `next` is null); null when the line is gone. */
export function replaceLogRow(text: string, raw: string, next: string | null): string | null {
	const lines = text.split("\n");
	const i = lines.indexOf(raw);
	if (i < 0) return null;
	if (next === null) lines.splice(i, 1);
	else lines[i] = next;
	return lines.join("\n");
}

/** A deck cell's link: target and shown text, for wikilinks and Markdown links; null for plain text. */
function parseDeckLink(cellText: string): { target: string; alias: string | null } | null {
	const t = cellText.trim();
	const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(t);
	if (wiki) return { target: wiki[1].trim(), alias: wiki[2]?.trim() || null };
	const md = /^\[([^\]]*)\]\(<?([^)>]+)>?\)$/.exec(t);
	if (!md) return null;
	let target = md[2].trim().replace(/#.*$/, "");
	try {
		target = decodeURI(target);
	} catch {
		// Not percent-encoded: keep it as written.
	}
	return { target: target.replace(/\.md$/i, ""), alias: md[1].trim() || null };
}

/** Link target of a deck cell ("[[Decks/Somnus Revive|Somnus]]" or "[Somnus](Decks/Somnus%20Revive.md)" → "Decks/Somnus Revive"), or null for plain text. */
export function deckLinkTarget(cellText: string): string | null {
	return parseDeckLink(cellText)?.target ?? null;
}

/** What a deck cell shows: the link's alias or file name, or the text itself. */
export function deckCellLabel(cellText: string): string {
	const link = parseDeckLink(cellText);
	if (!link) return cellText.trim();
	return link.alias ?? link.target.split("/").pop() ?? link.target;
}

/** Newest version first ("0.10.0" before "0.9.2"); text that isn't a version sorts last. */
export function comparePatches(a: string, b: string): number {
	const version = (v: string) => (/^v?\d+(\.\d+)*$/i.test(v.trim()) ? v.trim().replace(/^v/i, "").split(".").map(Number) : null);
	const va = version(a);
	const vb = version(b);
	if (!va || !vb) return va ? -1 : vb ? 1 : a.localeCompare(b);
	for (let i = 0; i < Math.max(va.length, vb.length); i++) {
		const d = (vb[i] ?? 0) - (va[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

// ---- stats -------------------------------------------------------------------

export function pairingLabel(opponent: Syndicate[]): string {
	return opponent.length ? opponent.join(" + ") : "Unknown";
}

export function tally(matches: Match[]): MatchRecord {
	const wins = matches.filter((m) => m.result === "W").length;
	return { wins, losses: matches.length - wins, games: matches.length };
}

/** Share of games won, or null without any game. */
export function winRate(r: MatchRecord): number | null {
	return r.games ? r.wins / r.games : null;
}

export function formatRate(rate: number | null): string {
	return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

export function formatRecord(r: MatchRecord): string {
	return `${r.wins}–${r.losses}`;
}

/** Records grouped by `key`, most played first. Items with an empty key are left out. */
export function groupRecords<T>(items: T[], key: (item: T) => string, match: (item: T) => Match): Array<{ key: string; record: MatchRecord }> {
	const groups = new Map<string, Match[]>();
	for (const item of items) {
		const k = key(item);
		if (!k) continue;
		const list = groups.get(k) ?? [];
		list.push(match(item));
		groups.set(k, list);
	}
	return Array.from(groups, ([k, ms]) => ({ key: k, record: tally(ms) })).sort((a, b) => b.record.games - a.record.games || a.key.localeCompare(b.key));
}

/** Current streak, from the last game back: e.g. { result: "W", count: 3 }. */
export function currentStreak(matches: Match[]): { result: MatchResult; count: number } | null {
	const last = matches[matches.length - 1];
	if (!last) return null;
	let count = 0;
	for (let i = matches.length - 1; i >= 0 && matches[i].result === last.result; i--) count++;
	return { result: last.result, count };
}

/** Below this many games, a win rate says little: the tracker shows it faded. */
export const SMALL_SAMPLE = 3;

/**
 * Whether a game's opponent matches the "Vs" filter: no syndicate = every game,
 * one = every game against it (whatever the other one was), two = that pair.
 */
export function matchesVs(opponent: Syndicate[], vs: Syndicate[]): boolean {
	return vs.every((s) => opponent.includes(s));
}

/** Monday of the date's week, as YYYY-MM-DD; null for a missing or unreadable date. */
export function weekOf(date: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
	if (!m) return null;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
}

/** Record per week (by date, oldest first); undated games are left out. */
export function weeklyRecords(matches: Match[]): Array<{ week: string; record: MatchRecord }> {
	return groupRecords(matches, (m) => weekOf(m.date) ?? "", (m) => m).sort((a, b) => a.key.localeCompare(b.key)).map((g) => ({ week: g.key, record: g.record }));
}

export function today(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
