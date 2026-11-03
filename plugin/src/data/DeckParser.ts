import { decodeDeck } from "./DeckCodec";
import { looksLikeDeckCode, unwrapDeckCode } from "./deckInput";
import { Deck, DeckEntry } from "./types";

/**
 * Parses the body of a ```chrono-deck block. Supported bodies:
 *
 *   1. A bare deck code:            AUGVG33NNZ2X…
 *   2. YAML:
 *        name: My Deck
 *        code: AUGVG33NNZ2X…           (used when `cards` is empty)
 *        divers: [122, Shattersmith]
 *        cards:
 *          - { id: 133, count: 2 }
 *          - { name: Hush Now, count: 3 }
 *          - 3 Librarian's Assistant
 *   3. Plain lines:
 *        name: My Deck                 (optional, first line)
 *        D 122                         (Diver, by id or name)
 *        3 133
 *        2 Hush Now
 *        # comments are ignored
 */
export interface ParsedDeck extends Deck {
	errors: string[];
}

/** Resolves an id or card name to a card id. */
export type CardRefResolver = (ref: string) => number | undefined;
export type YamlParser = (source: string) => unknown;

export const MAX_DECK_BLOCK_CHARS = 20_000;
export const MAX_DECK_LINES = 1_000;
export const MAX_DECK_ENTRIES = 2_000;

export function parseDeckSource(source: string, resolve: CardRefResolver, parseYaml: YamlParser): ParsedDeck {
	const errors: string[] = [];
	const empty = (msg: string): ParsedDeck => ({ name: "", divers: [], entries: [], errors: [msg] });
	const trimmed = source.trim();
	if (!trimmed) return empty("Empty deck.");
	if (trimmed.length > MAX_DECK_BLOCK_CHARS) {
		return empty(`Deck block too large (max ${MAX_DECK_BLOCK_CHARS} characters).`);
	}

	const lines = trimmed.split("\n").map((s) => s.trim()).filter(Boolean);
	const maybeCode = unwrapDeckCode(lines.length === 1 ? lines[0] : "");
	if (looksLikeDeckCode(maybeCode)) return fromCode(maybeCode, undefined, errors);

	if (/^[a-zA-Z_]+\s*:/.test(trimmed) && !isPlainWithHeader(lines)) {
		let data: YamlDeck;
		try {
			data = (parseYaml(trimmed) ?? {}) as YamlDeck;
		} catch (e) {
			return empty(`YAML parse error: ${(e as Error).message}`);
		}
		const cardsList = Array.isArray(data.cards) ? data.cards : [];
		if (data.code && cardsList.length === 0) {
			return fromCode(unwrapDeckCode(String(data.code)), data.name ? String(data.name) : undefined, errors);
		}
		const divers = toRefList(data.divers)
			.map((ref) => resolveOrError(ref, resolve, errors, "Diver"))
			.filter((id): id is number => id !== undefined);
		const entries: DeckEntry[] = [];
		for (const raw of cardsList.slice(0, MAX_DECK_ENTRIES)) {
			const entry = yamlEntry(raw, resolve, errors);
			if (entry) entries.push(entry);
		}
		if (cardsList.length > MAX_DECK_ENTRIES) errors.push(`Too many deck entries (max ${MAX_DECK_ENTRIES}).`);
		return {
			name: data.name ? String(data.name) : "",
			code: data.code ? String(data.code) : undefined,
			divers,
			entries: mergeEntries(entries),
			errors,
		};
	}

	// Plain lines
	if (lines.length > MAX_DECK_LINES) return empty(`Too many lines in deck block (max ${MAX_DECK_LINES}).`);
	let name = "";
	const divers: number[] = [];
	const entries: DeckEntry[] = [];
	for (const t of lines) {
		if (t.startsWith("#") || t.startsWith("//")) continue;
		const header = t.match(/^name\s*:\s*(.+)$/i);
		if (header) {
			name = header[1].trim();
			continue;
		}
		const diver = t.match(/^(?:d|diver)\s*[:\s]\s*(.+)$/i);
		if (diver) {
			const id = resolveOrError(diver[1], resolve, errors, "Diver");
			if (id !== undefined) divers.push(id);
			continue;
		}
		const m = t.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
		if (!m) {
			errors.push(`Could not parse line "${t}" (expected "<count> <id or name>" or "D <diver>").`);
			continue;
		}
		const id = resolveOrError(m[2], resolve, errors, "Card");
		if (id !== undefined) entries.push({ count: Number(m[1]), id });
		if (entries.length >= MAX_DECK_ENTRIES) {
			errors.push(`Too many deck entries (max ${MAX_DECK_ENTRIES}).`);
			break;
		}
	}
	return { name, divers, entries: mergeEntries(entries), errors };
}

interface YamlDeck {
	name?: unknown;
	code?: unknown;
	divers?: unknown;
	cards?: unknown[];
}

/** "name: X" followed by plain "<count> <ref>" lines is not YAML. */
function isPlainWithHeader(lines: string[]): boolean {
	return lines.slice(1).some((l) => /^(\d+\s*[x×]?\s+\S|(d|diver)\s*[:\s]\s*\S)/i.test(l) && !l.startsWith("-"));
}

function fromCode(code: string, nameOverride: string | undefined, errors: string[]): ParsedDeck {
	try {
		const d = decodeDeck(code, { maxDecodedBytes: 8_192, maxEntries: MAX_DECK_ENTRIES });
		return {
			name: nameOverride ?? d.name,
			code,
			divers: d.divers,
			entries: d.entries,
			errors: [...errors, ...d.warnings],
		};
	} catch (e) {
		return { name: nameOverride ?? "", divers: [], entries: [], errors: [...errors, `Deck code parse error: ${(e as Error).message}`] };
	}
}

function toRefList(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	const arr = Array.isArray(value) ? value : String(value).split(",");
	return arr.map((v) => String(v).trim()).filter(Boolean);
}

function yamlEntry(raw: unknown, resolve: CardRefResolver, errors: string[]): DeckEntry | null {
	if (typeof raw === "string" || typeof raw === "number") {
		const s = String(raw).trim();
		const m = s.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
		const ref = m ? m[2] : s;
		const count = m ? Number(m[1]) : 1;
		const id = resolveOrError(ref, resolve, errors, "Card");
		return id !== undefined && count > 0 ? { id, count } : null;
	}
	if (raw && typeof raw === "object") {
		const r = raw as Record<string, unknown>;
		const ref = r.id ?? r.name ?? r.card;
		if (ref === undefined) {
			errors.push(`Deck entry is missing an id or name: ${JSON.stringify(raw)}`);
			return null;
		}
		const id = resolveOrError(String(ref), resolve, errors, "Card");
		const count = Number(r.count ?? 1);
		if (id === undefined) return null;
		if (!Number.isFinite(count) || count <= 0) {
			errors.push(`Invalid count for card ${ref}.`);
			return null;
		}
		return { id, count };
	}
	return null;
}

function resolveOrError(ref: string, resolve: CardRefResolver, errors: string[], what: string): number | undefined {
	const trimmed = ref.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	const id = resolve(trimmed);
	if (id === undefined) errors.push(`${what} "${trimmed}" not found.`);
	return id;
}

export function mergeEntries(entries: DeckEntry[]): DeckEntry[] {
	const counts = new Map<number, number>();
	for (const e of entries) counts.set(e.id, (counts.get(e.id) ?? 0) + e.count);
	return Array.from(counts, ([id, count]) => ({ id, count }));
}
