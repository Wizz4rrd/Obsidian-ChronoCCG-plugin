export function unwrapDeckCode(input: string): string {
	let out = (input ?? "").trim();
	if (!out) return out;

	const first = out[0];
	const last = out[out.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`")) {
		out = out.slice(1, -1).trim();
	}
	return out;
}

export function looksLikeDeckCode(value: string): boolean {
	const normalized = unwrapDeckCode(value);
	return /^[A-Z2-7=]+$/i.test(normalized) && normalized.length >= 8;
}

const DECK_FENCE = /^(`{3,}|~{3,})\s*chrono-deck\b/;

/** Line range of the first ```chrono-deck block: the one a deck note's properties describe. */
export function findFirstDeckBlock(lines: string[]): { start: number; end: number } | null {
	const start = lines.findIndex((l) => DECK_FENCE.test(l.trim()));
	return start >= 0 ? findDeckBlockAt(lines, start) : null;
}

/** Line range of the ```chrono-deck block containing `line` (fence lines inclusive). */
export function findDeckBlockAt(lines: string[], line: number): { start: number; end: number } | null {
	let start = -1;
	for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
		const t = lines[i].trim();
		if (DECK_FENCE.test(t)) {
			start = i;
			break;
		}
		if (i !== line && /^(`{3,}|~{3,})\s*$/.test(t)) return null;
	}
	if (start < 0) return null;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^(`{3,}|~{3,})\s*$/.test(lines[i].trim())) return i >= line ? { start, end: i } : null;
	}
	return null;
}

/** The ```chrono-deck block whose content is `body` (ignoring surrounding whitespace). */
export function findDeckBlockByBody(lines: string[], body: string): { start: number; end: number } | null {
	const want = body.trim();
	for (let i = 0; i < lines.length; i++) {
		if (!DECK_FENCE.test(lines[i].trim())) continue;
		const range = findDeckBlockAt(lines, i);
		if (!range) return null;
		if (lines.slice(range.start + 1, range.end).join("\n").trim() === want) return range;
		i = range.end;
	}
	return null;
}

/**
 * The block a deck builder draft came from: still at its first line, or found
 * again by its content when the note changed above it.
 */
export function locateDeckBlock(
	lines: string[],
	link: { lineStart: number; body?: string },
): { start: number; end: number } | null {
	const at = DECK_FENCE.test(lines[link.lineStart]?.trim() ?? "") ? findDeckBlockAt(lines, link.lineStart) : null;
	if (link.body === undefined) return at;
	// Another deck block may have moved onto that line: the content decides, and the
	// position only counts when the block was edited by hand since.
	if (at && lines.slice(at.start + 1, at.end).join("\n").trim() === link.body.trim()) return at;
	return findDeckBlockByBody(lines, link.body) ?? at;
}
