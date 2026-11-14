import { DeckEntry } from "./types";

/**
 * Encoder / decoder for ChronoCCG deck codes (the format used in-game, on the
 * official leaderboard and by third-party sites).
 *
 * Format, per the official "Chrono CCG Public Data" guide (base32 RFC 4648, no padding):
 *   1 byte  version (currently 5)
 *   varint  nameLen, then N bytes UTF-8 name
 *   varint  formatLen, then N bytes UTF-8 format (e.g. "constructed")
 *   2 × uint16 LE  Diver card ids (count 1 each, outside the main deck)
 *   varint  num_count_1   (main-deck cards with 1 copy)
 *   N varint deltas (running ascending card id)
 *   varint  num_count_2
 *   N varint deltas
 *   varint  num_remaining  (cards with count >= 3)
 *   N × (varint delta, varint count) pairs
 *
 * The encoder output matches codes from the game byte-for-byte. The decoder
 * is tolerant: it returns whatever it manages to read and a list of warnings
 * for the rest.
 */
export const DECK_CODE_VERSION = 5;
export const DEFAULT_DECK_FORMAT = "constructed";

export interface DecodedDeck {
	version: number;
	name: string;
	format: string;
	/** Diver card ids, in code order. */
	divers: number[];
	/** Main-deck entries (Divers excluded). */
	entries: DeckEntry[];
	warnings: string[];
}

export interface DecodeDeckOptions {
	maxDecodedBytes?: number;
	maxEntries?: number;
}

export function decodeDeck(code: string, options: DecodeDeckOptions = {}): DecodedDeck {
	const maxDecodedBytes = options.maxDecodedBytes ?? 8_192;
	const maxEntries = options.maxEntries ?? 2_000;
	const cleaned = code.trim().replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
	const bytes = base32Decode(cleaned);
	if (bytes.length > maxDecodedBytes) {
		throw new Error(`deck code too large (${bytes.length} bytes, max ${maxDecodedBytes})`);
	}
	const r = new ByteReader(bytes);
	const warnings: string[] = [];
	const divers: number[] = [];
	const entries: DeckEntry[] = [];

	const version = r.u8();
	if (version !== DECK_CODE_VERSION) {
		warnings.push(`Unknown deck code version ${version} (expected ${DECK_CODE_VERSION}); decoding anyway.`);
	}
	const name = r.lenString();
	const format = r.lenString();

	for (let i = 0; i < 2 && r.remaining >= 2; i++) {
		const id = r.u16le();
		if (id > 0) divers.push(id);
	}

	try {
		readGroup(r, entries, 1, maxEntries);
		readGroup(r, entries, 2, maxEntries);
		readVariableGroup(r, entries, maxEntries);
	} catch (err) {
		warnings.push(`Stopped parsing early: ${(err as Error).message}`);
	}

	if (r.remaining > 0) {
		warnings.push(`${r.remaining} trailing bytes ignored.`);
	}

	return { version, name, format, divers, entries, warnings };
}

export interface EncodeDeckInput {
	name?: string;
	format?: string;
	divers: number[];
	entries: DeckEntry[];
}

export function encodeDeck(deck: EncodeDeckInput): string {
	const out: number[] = [DECK_CODE_VERSION];
	writeLenString(out, deck.name?.trim() || "Untitled Deck");
	writeLenString(out, deck.format || DEFAULT_DECK_FORMAT);

	if (deck.divers.length > 2) throw new Error("a deck has at most 2 Divers");
	for (let i = 0; i < 2; i++) {
		const id = deck.divers[i] ?? 0;
		if (!Number.isInteger(id) || id < 0 || id > 0xffff) throw new Error(`invalid Diver id ${id}`);
		out.push(id & 0xff, (id >> 8) & 0xff);
	}

	// Merge duplicates, drop non-positive counts.
	const counts = new Map<number, number>();
	for (const e of deck.entries) {
		if (!Number.isInteger(e.id) || e.id < 0) throw new Error(`invalid card id ${e.id}`);
		if (e.count > 0) counts.set(e.id, (counts.get(e.id) ?? 0) + e.count);
	}
	const sorted = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);

	for (const n of [1, 2]) {
		const ids = sorted.filter(([, c]) => c === n).map(([id]) => id);
		writeVarint(out, ids.length);
		let prev = 0;
		for (const id of ids) {
			writeVarint(out, id - prev);
			prev = id;
		}
	}
	const rest = sorted.filter(([, c]) => c >= 3);
	writeVarint(out, rest.length);
	let prev = 0;
	for (const [id, count] of rest) {
		writeVarint(out, id - prev);
		writeVarint(out, count);
		prev = id;
	}

	return base32Encode(new Uint8Array(out));
}

function writeLenString(out: number[], value: string): void {
	let bytes = new TextEncoder().encode(value);
	if (bytes.length > 255) bytes = bytes.subarray(0, 255);
	writeVarint(out, bytes.length);
	out.push(...bytes);
}

function writeVarint(out: number[], value: number): void {
	let v = value;
	while (v >= 0x80) {
		out.push((v & 0x7f) | 0x80);
		v = Math.floor(v / 128);
	}
	out.push(v);
}

function readGroup(r: ByteReader, out: DeckEntry[], count: number, maxEntries: number): void {
	const n = r.varint();
	let id = 0;
	for (let i = 0; i < n; i++) {
		if (out.length >= maxEntries) throw new Error(`too many entries (max ${maxEntries})`);
		id += r.varint();
		out.push({ id, count });
	}
}

function readVariableGroup(r: ByteReader, out: DeckEntry[], maxEntries: number): void {
	const n = r.varint();
	let id = 0;
	for (let i = 0; i < n; i++) {
		if (out.length >= maxEntries) throw new Error(`too many entries (max ${maxEntries})`);
		id += r.varint();
		const count = r.varint();
		out.push({ id, count });
	}
}

class ByteReader {
	private i = 0;
	constructor(private buf: Uint8Array) {}

	get remaining(): number {
		return this.buf.length - this.i;
	}

	u8(): number {
		if (this.remaining < 1) throw new Error("unexpected end of buffer");
		return this.buf[this.i++];
	}

	u16le(): number {
		const lo = this.u8();
		const hi = this.u8();
		return lo | (hi << 8);
	}

	varint(): number {
		// LEB128 unsigned
		let result = 0;
		let shift = 0;
		while (true) {
			const b = this.u8();
			result += (b & 0x7f) * 2 ** shift;
			if (!Number.isSafeInteger(result)) throw new Error("varint overflow");
			if ((b & 0x80) === 0) return result;
			shift += 7;
			if (shift > 35) throw new Error("varint too long");
		}
	}

	lenString(): string {
		const len = this.varint();
		if (this.remaining < len) throw new Error("string longer than buffer");
		const slice = this.buf.subarray(this.i, this.i + len);
		this.i += len;
		return new TextDecoder("utf-8").decode(slice);
	}
}

// ---- base32 (RFC 4648, A–Z + 2–7, no padding) ----------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
	const out: number[] = [];
	let bits = 0;
	let value = 0;
	for (const ch of input) {
		const idx = ALPHABET.indexOf(ch);
		if (idx === -1) throw new Error(`invalid base32 char "${ch}"`);
		value = ((value << 5) | idx) & 0xffff;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			out.push((value >>> bits) & 0xff);
		}
	}
	return new Uint8Array(out);
}

function base32Encode(bytes: Uint8Array): string {
	let out = "";
	let bits = 0;
	let value = 0;
	for (const b of bytes) {
		value = ((value << 8) | b) & 0xffff;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += ALPHABET[(value >>> bits) & 31];
		}
	}
	if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
	return out;
}
