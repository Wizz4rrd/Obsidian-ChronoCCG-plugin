import { CardLookup } from "./DeckRules";
import { Deck } from "./types";

/**
 * Changelog lines written when the deck builder saves a deck note, e.g.
 *
 *   - 2026-11-14 — Diver `chrono:Ana` → `chrono:Bo`, +2 `chrono:Bloom`, −1 `chrono:Throwdown`
 *
 * Cards are inline references, so they render with their colour and preview.
 * Saving again on the same day merges into that line (net change), as long as
 * the line is still in this format.
 */

/** Net change of a deck, keyed by card reference (name, or id when the card is unknown). */
export interface DeckChange {
	cards: Map<string, number>;
	/** +1 Diver added, -1 Diver removed. */
	divers: Map<string, number>;
	/** New deck name, when it was renamed. */
	name?: string;
	/** Name before the rename, when it had one. */
	from?: string;
}

const ENTRY = /^- (\d{4}-\d{2}-\d{2}) — (.+)$/;
/** A card reference, capturing the card. */
const REF = "`chrono:([^`]+)`";
const ANY_REF = "`chrono:[^`]+`";
const ITEM = new RegExp(`renamed to “[^”]*”|renamed “[^”]*” → “[^”]*”|Diver ${ANY_REF} → ${ANY_REF}|[+−-]Diver ${ANY_REF}|[+−-]\\d+ ${ANY_REF}`, "g");

export function diffDecks(before: Deck, after: Deck, cards: CardLookup): DeckChange {
	const ref = (id: number) => cards.getById(id)?.name ?? String(id);
	const change: DeckChange = { cards: new Map(), divers: new Map() };
	const counts = new Map<number, number>();
	for (const e of before.entries) counts.set(e.id, (counts.get(e.id) ?? 0) - e.count);
	for (const e of after.entries) counts.set(e.id, (counts.get(e.id) ?? 0) + e.count);
	for (const [id, n] of counts) if (n) add(change.cards, ref(id), n);
	for (const id of before.divers) if (!after.divers.includes(id)) add(change.divers, ref(id), -1);
	for (const id of after.divers) if (!before.divers.includes(id)) add(change.divers, ref(id), 1);
	const name = after.name.trim();
	if (name && name !== before.name.trim()) {
		change.name = name;
		if (before.name.trim()) change.from = before.name.trim();
	}
	return change;
}

/** `b` applied after `a`. */
export function mergeChanges(a: DeckChange, b: DeckChange): DeckChange {
	const out: DeckChange = { cards: new Map(a.cards), divers: new Map(a.divers), name: b.name ?? a.name };
	out.from = a.name !== undefined ? a.from : b.from;
	// Renamed back to the name it had before.
	if (out.name !== undefined && out.name === out.from) out.name = out.from = undefined;
	for (const [r, n] of b.cards) add(out.cards, r, n);
	for (const [r, n] of b.divers) add(out.divers, r, n);
	return out;
}

/** Changelog text of a change; "" when nothing changed. */
export function formatChange(change: DeckChange): string {
	const ref = (r: string) => `\`chrono:${r}\``;
	const items: string[] = [];
	if (change.name) items.push(change.from ? `renamed “${change.from}” → “${change.name}”` : `renamed to “${change.name}”`);
	const added = [...change.divers].filter(([, n]) => n > 0).map(([r]) => r);
	const removed = [...change.divers].filter(([, n]) => n < 0).map(([r]) => r);
	if (added.length === 1 && removed.length === 1) items.push(`Diver ${ref(removed[0])} → ${ref(added[0])}`);
	else {
		for (const r of added) items.push(`+Diver ${ref(r)}`);
		for (const r of removed) items.push(`−Diver ${ref(r)}`);
	}
	const cardChanges = [...change.cards].filter(([, n]) => n !== 0);
	cardChanges.sort(([ra, a], [rb, b]) => Number(b > 0) - Number(a > 0) || ra.localeCompare(rb));
	for (const [r, n] of cardChanges) items.push(`${n > 0 ? "+" : "−"}${Math.abs(n)} ${ref(r)}`);
	return items.join(", ");
}

/** Reads back a line written by {@link formatChange}; null when it has other text in it. */
export function parseChange(text: string): DeckChange | null {
	const items = text.match(ITEM) ?? [];
	if (!items.length || items.join(", ") !== text.trim()) return null;
	const change: DeckChange = { cards: new Map(), divers: new Map() };
	for (const item of items) {
		let m: RegExpMatchArray | null;
		if ((m = item.match(/^renamed to “([^”]*)”$/))) change.name = m[1];
		else if ((m = item.match(/^renamed “([^”]*)” → “([^”]*)”$/))) {
			change.from = m[1];
			change.name = m[2];
		}
		else if ((m = item.match(new RegExp(`^Diver ${REF} → ${REF}$`)))) {
			add(change.divers, m[1], -1);
			add(change.divers, m[2], 1);
		} else if ((m = item.match(new RegExp(`^([+−-])Diver ${REF}$`)))) add(change.divers, m[2], m[1] === "+" ? 1 : -1);
		else if ((m = item.match(new RegExp(`^([+−-])(\\d+) ${REF}$`)))) add(change.cards, m[3], (m[1] === "+" ? 1 : -1) * Number(m[2]));
	}
	return change;
}

/**
 * `text` (a whole note) with the change from `before` to `after` logged under
 * its "Changelog" heading. Unchanged when the note has no such heading or the
 * deck didn't change.
 */
export function logDeckChange(text: string, before: Deck, after: Deck, cards: CardLookup, date: string): string {
	const lines = text.split("\n");
	const heading = lines.findIndex((l) => /^#{1,6}\s+changelog\s*$/i.test(l.trim()));
	if (heading < 0) return text;
	const level = (lines[heading].trim().match(/^#+/) ?? [""])[0].length;
	let end = lines.length;
	for (let i = heading + 1; i < lines.length; i++) {
		const m = lines[i].match(/^(#{1,6})\s/);
		if (m && m[1].length <= level) {
			end = i;
			break;
		}
	}
	let last = -1;
	for (let i = heading + 1; i < end; i++) if (/^\s*[-*+]\s/.test(lines[i])) last = i;

	const change = diffDecks(before, after, cards);
	const today = last >= 0 ? lines[last].match(ENTRY) : null;
	const earlier = today && today[1] === date ? parseChange(today[2]) : null;
	if (earlier) {
		const merged = formatChange(mergeChanges(earlier, change));
		if (merged) lines[last] = `- ${date} — ${merged}`;
		else lines.splice(last, 1);
		return lines.join("\n");
	}
	const entry = formatChange(change);
	if (!entry) return text;
	lines.splice(last >= 0 ? last + 1 : heading + 1, 0, `- ${date} — ${entry}`);
	return lines.join("\n");
}

function add(map: Map<string, number>, key: string, n: number): void {
	const v = (map.get(key) ?? 0) + n;
	if (v) map.set(key, v);
	else map.delete(key);
}
